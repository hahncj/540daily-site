// Member-owned API keys. An agent using a key acts as the member who created it, with that member's
// current role. Only a SHA-256 hash is stored; the secret is returned once, at creation.
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Database } from "./adapters/db";
import { hasRole, type MemberStatus, type Role } from "./core/access";
import type { Audit } from "./core/audit";
import { randomToken } from "./core/hash";
import { fail, ok, type Result } from "./core/result";
import { apiKeys } from "./db/schema";

/** Every key starts with this, so agent auth can tell keys from OAuth JWTs without a lookup. */
export const API_KEY_PREFIX = "540daily_";
export const MAX_KEY_LABEL = 80;
const DISPLAY_CHARS = 6;
/** `last_used_at` is written at most this often per key. */
const LAST_USED_RESOLUTION_MS = 60 * 60 * 1000;
const MAX_KEY_LENGTH = 200;

type ViewerLike = { userId: string; role: Role; status: MemberStatus };

export type ApiKeyInfo = {
  id: string;
  userId: string;
  label: string;
  displayPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

/** SHA-256 of the full key, base64url. */
export async function hashApiKey(key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  let binary = "";
  for (const b of digest) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function looksLikeApiKey(token: string): boolean {
  return token.startsWith(API_KEY_PREFIX);
}

export type ApiKeys = ReturnType<typeof createApiKeys>;

export function createApiKeys({ db, audit, now, newId }: { db: Database; audit: Audit; now: () => Date; newId: () => string }) {
  const columns = {
    id: apiKeys.id,
    userId: apiKeys.userId,
    label: apiKeys.label,
    displayPrefix: apiKeys.displayPrefix,
    createdAt: apiKeys.createdAt,
    lastUsedAt: apiKeys.lastUsedAt,
    revokedAt: apiKeys.revokedAt,
  };

  return {
    /** Editors and the owner create keys for their own account. The secret is in the result only this once. */
    async create(viewer: ViewerLike, label: string): Promise<Result<{ key: string; info: ApiKeyInfo }>> {
      if (!hasRole(viewer, "editor")) return fail("forbidden", "Only editors and the owner can create API keys.");
      const cleanLabel = label.normalize("NFKC").replace(/\s+/g, " ").trim();
      if (!cleanLabel || cleanLabel.length > MAX_KEY_LABEL) {
        return fail("invalid", "Invalid API key.", { errors: { label: [`1–${MAX_KEY_LABEL} characters.`] } });
      }
      const key = `${API_KEY_PREFIX}${randomToken(32)}`;
      const info: ApiKeyInfo = {
        id: newId(),
        userId: viewer.userId,
        label: cleanLabel,
        displayPrefix: key.slice(0, API_KEY_PREFIX.length + DISPLAY_CHARS),
        createdAt: now(),
        lastUsedAt: null,
        revokedAt: null,
      };
      await db.insert(apiKeys).values({ ...info, keyHash: await hashApiKey(key) });
      await audit.record({ kind: "member", userId: viewer.userId }, "api_key.create", { type: "api_key", id: info.id }, { label: cleanLabel });
      return ok({ key, info });
    },

    /**
     * The unrevoked key matching `key`, or null. Membership status and role are checked by the caller.
     * Updates `last_used_at` at most once an hour (best effort).
     */
    async verify(key: string): Promise<Pick<ApiKeyInfo, "id" | "userId" | "label"> | null> {
      if (!looksLikeApiKey(key) || key.length > MAX_KEY_LENGTH) return null;
      const [row] = await db
        .select(columns)
        .from(apiKeys)
        .where(and(eq(apiKeys.keyHash, await hashApiKey(key)), isNull(apiKeys.revokedAt)))
        .limit(1);
      if (!row) return null;
      const at = now();
      if (!row.lastUsedAt || at.getTime() - row.lastUsedAt.getTime() >= LAST_USED_RESOLUTION_MS) {
        try {
          await db.update(apiKeys).set({ lastUsedAt: at }).where(eq(apiKeys.id, row.id));
        } catch (error) {
          console.error(JSON.stringify({ event: "api_key_last_used_failed", keyId: row.id, error: String(error) }));
        }
      }
      return { id: row.id, userId: row.userId, label: row.label };
    },

    /** A member's own keys, newest first. Never includes the hash. */
    async listOwn(viewer: ViewerLike): Promise<ApiKeyInfo[]> {
      if (viewer.status !== "active") return [];
      return db.select(columns).from(apiKeys).where(eq(apiKeys.userId, viewer.userId)).orderBy(desc(apiKeys.createdAt));
    },

    /** Owner only: every member's keys, newest first. */
    async listAll(viewer: ViewerLike): Promise<ApiKeyInfo[] | null> {
      if (!hasRole(viewer, "owner")) return null;
      return db.select(columns).from(apiKeys).orderBy(desc(apiKeys.createdAt)).limit(1000);
    },

    /** A member revokes their own key; the owner can revoke any member's. Revoking twice is a no-op. */
    async revoke(viewer: ViewerLike, keyId: string): Promise<Result<{ id: string }>> {
      if (viewer.status !== "active") return fail("forbidden", "Your account is not active.");
      const [row] = await db.select(columns).from(apiKeys).where(eq(apiKeys.id, keyId)).limit(1);
      if (!row || (row.userId !== viewer.userId && !hasRole(viewer, "owner"))) return fail("not_found", "API key not found.");
      if (!row.revokedAt) {
        await db.update(apiKeys).set({ revokedAt: now() }).where(and(eq(apiKeys.id, keyId), isNull(apiKeys.revokedAt)));
        await audit.record({ kind: "member", userId: viewer.userId }, "api_key.revoke", { type: "api_key", id: keyId }, { ownerUserId: row.userId });
      }
      return ok({ id: keyId });
    },
  };
}
