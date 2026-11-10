// Agent authentication: every MCP and HTTP API call resolves its bearer credential (a member's API key
// or an MCP OAuth access token) to the member who connected it, re-reading that member's status and
// current role from the database. Revoking a key, disconnecting a client, disabling a member, or
// demoting an editor therefore takes effect on the very next call.
import { verifyJwsAccessToken } from "@better-auth/core/oauth2";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { JSONWebKeySet } from "jose";
import { atomic } from "./adapters/atomic";
import type { Database } from "./adapters/db";
import { looksLikeApiKey } from "./api-keys";
import type { Services } from "./app";
import { mcpResourceUrl } from "./auth/auth";
import { hasRole, type MemberStatus, type Role } from "./core/access";
import type { AgentActor } from "./core/actors";
import type { Audit } from "./core/audit";
import { fail, ok, type Result } from "./core/result";
import { memberships, oauthClient, oauthConsent, oauthRefreshToken, toolRevocations } from "./db/schema";

/** An agent acting as a member. Same shape core uses for agent actors. */
export type AgentPrincipal = AgentActor;

export type AgentAuth = { ok: true; principal: AgentPrincipal } | { ok: false; reason: "missing" | "invalid" };

const DEFAULT_CLIENT_LABEL = "MCP client";
const MAX_TOKEN_LENGTH = 8192;

/** The bearer token from `Authorization`, or null. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  const token = header?.match(/^Bearer\s+(\S+)\s*$/i)?.[1];
  return token && token.length <= MAX_TOKEN_LENGTH ? token : null;
}

export async function authenticateAgent(request: Request, services: Services): Promise<AgentAuth> {
  const token = bearerToken(request);
  if (!token) return { ok: false, reason: "missing" };

  if (looksLikeApiKey(token)) {
    const key = await services.apiKeys.verify(token);
    const member = key && (await services.members.getActive(key.userId));
    if (!key || !member) return { ok: false, reason: "invalid" };
    return {
      ok: true,
      principal: { kind: "agent", userId: member.userId, role: member.role, credentialKind: "api_key", credentialId: key.id, label: key.label },
    };
  }

  let claims: { sub?: unknown; azp?: unknown; iat?: unknown };
  try {
    const { baseURL: issuer } = await services.auth.$context;
    claims = await verifyJwsAccessToken(token, {
      // In-process: a Worker cannot fetch its own hostname.
      jwksFetch: async () => (await services.auth.api.getJwks()) as JSONWebKeySet,
      jwksCacheKey: services.auth,
      verifyOptions: { issuer, audience: mcpResourceUrl(services.config), requiredClaims: ["azp", "sub", "iat"] },
    });
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const userId = typeof claims.sub === "string" ? claims.sub : null;
  const clientId = typeof claims.azp === "string" ? claims.azp : null;
  const issuedAt = typeof claims.iat === "number" ? claims.iat : null;
  if (!userId || !clientId || issuedAt === null) return { ok: false, reason: "invalid" };

  const [client, revocation, member] = await Promise.all([
    services.db.select({ name: oauthClient.name, disabled: oauthClient.disabled }).from(oauthClient).where(eq(oauthClient.clientId, clientId)).limit(1),
    services.db
      .select({ revokedAt: toolRevocations.revokedAt })
      .from(toolRevocations)
      .where(and(eq(toolRevocations.userId, userId), eq(toolRevocations.clientId, clientId)))
      .limit(1),
    services.members.getActive(userId),
  ]);
  if (!client[0] || client[0].disabled || !member) return { ok: false, reason: "invalid" };
  // Access tokens are self-contained JWTs: any token issued at or before the disconnect is refused.
  const revokedAt = revocation[0]?.revokedAt;
  if (revokedAt && revokedAt.getTime() >= issuedAt * 1000) return { ok: false, reason: "invalid" };

  return {
    ok: true,
    principal: {
      kind: "agent",
      userId: member.userId,
      role: member.role,
      credentialKind: "oauth",
      credentialId: clientId,
      label: client[0].name?.trim().slice(0, 100) || DEFAULT_CLIENT_LABEL,
    },
  };
}

// ---------------------------------------------------------------------------
// MCP connections (the account and owner screens in lane 3A call these)
// ---------------------------------------------------------------------------

type ViewerLike = { userId: string; role: Role; status: MemberStatus };

export type McpConnection = { userId: string; clientId: string; clientName: string; connectedAt: Date };

export type Agents = ReturnType<typeof createAgents>;

export function createAgents({ db, audit, now }: { db: Database; audit: Audit; now: () => Date }) {
  async function connections(userId: string | null): Promise<McpConnection[]> {
    const rows = await db
      .select({ userId: oauthConsent.userId, clientId: oauthConsent.clientId, clientName: oauthClient.name, connectedAt: oauthConsent.createdAt })
      .from(oauthConsent)
      .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
      .where(userId ? eq(oauthConsent.userId, userId) : undefined)
      .orderBy(desc(oauthConsent.createdAt))
      .limit(1000);
    return rows
      .filter((r): r is typeof r & { userId: string } => r.userId !== null)
      .map((r) => ({ userId: r.userId, clientId: r.clientId, clientName: r.clientName?.trim() || DEFAULT_CLIENT_LABEL, connectedAt: r.connectedAt }));
  }

  return {
    /** The member's own approved MCP clients. */
    listOwnConnections: (viewer: ViewerLike) => (viewer.status === "active" ? connections(viewer.userId) : Promise.resolve([])),

    /** Owner only: every member's MCP connections. */
    listAllConnections: async (viewer: ViewerLike) => (hasRole(viewer, "owner") ? connections(null) : null),

    /**
     * Disconnect an MCP client from a member's account, in one atomic write: delete the consent rows,
     * revoke the refresh tokens, and record the revocation time so already-issued access tokens are refused.
     * Members disconnect their own clients; the owner can disconnect anyone's.
     */
    async disconnect(viewer: ViewerLike, target: { userId: string; clientId: string }): Promise<Result<{ clientId: string }>> {
      if (viewer.status !== "active") return fail("forbidden", "Your account is not active.");
      if (target.userId !== viewer.userId && !hasRole(viewer, "owner")) return fail("not_found", "Connection not found.");
      const [member] = await db.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.userId, target.userId)).limit(1);
      if (!member) return fail("not_found", "Connection not found.");
      const at = now();
      await atomic(db, [
        () => db.delete(oauthConsent).where(and(eq(oauthConsent.userId, target.userId), eq(oauthConsent.clientId, target.clientId))),
        () =>
          db
            .update(oauthRefreshToken)
            .set({ revoked: at })
            .where(and(eq(oauthRefreshToken.userId, target.userId), eq(oauthRefreshToken.clientId, target.clientId), isNull(oauthRefreshToken.revoked))),
        () =>
          db
            .insert(toolRevocations)
            .values({ userId: target.userId, clientId: target.clientId, revokedAt: at })
            .onConflictDoUpdate({ target: [toolRevocations.userId, toolRevocations.clientId], set: { revokedAt: at } }),
      ]);
      await audit.record({ kind: "member", userId: viewer.userId }, "mcp_connection.disconnect", { type: "oauth_client", id: target.clientId }, {
        memberUserId: target.userId,
      });
      return ok({ clientId: target.clientId });
    },
  };
}
