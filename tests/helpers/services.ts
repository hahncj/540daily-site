// Test helpers. All identities and content here are test data.
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createServices, handleRequest, type RenderPage, type Services } from "../../server/app";
import { SESSION_COOKIE } from "../../server/auth/auth";
import { fetchClientMetadataViaFetch } from "../../server/auth/cimd-fetch";
import { loadConfig } from "../../server/config";
import type { Role } from "../../server/core/access";
import * as schema from "../../server/db/schema";
import { MemoryMediaStore } from "./memory-media";

export const BASE_URL = "http://localhost:5173";
export const OWNER_EMAIL = "owner@example.test";
export const TEST_AUTH_SECRET = "test-secret-test-secret-test-secret-123";

export interface TestServices extends Services {
  media: MemoryMediaStore;
  sqlite: Database.Database;
}

/**
 * Fresh in-memory SQLite with the real migrations, plus real services.
 * Google's ID-token signature check is replaced, so tests can sign in through Better Auth's
 * real Google path with `googleIdToken()`. Nothing contacts Google.
 */
export function createTestServices(options: { env?: Record<string, string>; now?: () => Date; newId?: () => string } = {}): TestServices {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "db/migrations" });
  const config = loadConfig(
    {
      PUBLIC_BASE_URL: BASE_URL,
      OWNER_EMAIL,
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      GOOGLE_CLIENT_ID: "test-google-client-id",
      GOOGLE_CLIENT_SECRET: "test-google-client-secret",
      ...options.env,
    },
    "node",
  );
  const media = new MemoryMediaStore();
  const services = createServices({
    config,
    db,
    media,
    fetchClientMetadata: fetchClientMetadataViaFetch,
    now: options.now,
    newId: options.newId,
    googleTestOverrides: { verifyIdToken: async () => true },
  });
  return Object.assign(services, { media, sqlite });
}

const stubPage: RenderPage = async () => new Response("<html>page</html>", { headers: { "Content-Type": "text/html" } });

/** Send a request through the real dispatcher. Pages render as a stub unless `renderPage` is given. */
export function request(services: Services, path: string, init?: RequestInit, renderPage: RenderPage = stubPage) {
  return handleRequest(new Request(`${BASE_URL}${path}`, init), services, renderPage);
}

/** Insert a user and membership directly (test data), bypassing the sign-in gate. */
export async function createMember(services: Services, email: string, role: Role = "reader", status: "active" | "disabled" = "active") {
  const id = crypto.randomUUID();
  const now = new Date();
  await services.db.insert(schema.user).values({ id, email, name: `Test ${role}`, emailVerified: true, createdAt: now, updatedAt: now });
  await services.db.insert(schema.memberships).values({ userId: id, role, status, createdAt: now, updatedAt: now });
  return id;
}

/** Signed session cookie (`name=value`) for a new member with a role. Stands in for Google sign-in. */
export async function sessionCookieFor(services: Services, email: string, role: Role = "reader") {
  const { serializeSignedCookie } = await import("better-call");
  const userId = await createMember(services, email, role);
  const ctx = await services.auth.$context;
  const session = await ctx.internalAdapter.createSession(userId);
  if (!session) throw new Error("Session was refused for a test member.");
  const cookie = await serializeSignedCookie(SESSION_COOKIE, session.token, ctx.secret);
  return { userId, cookie: cookie.split(";")[0]! };
}

function base64url(value: string) {
  return Buffer.from(value).toString("base64url");
}

/**
 * An unsigned Google-shaped ID token (test data). Only usable because createTestServices replaces
 * the signature check; Better Auth still decodes it and runs the full sign-in path.
 */
export function googleIdToken(claims: { email: string; sub?: string; name?: string; emailVerified?: boolean }) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test" }));
  const payload = base64url(
    JSON.stringify({
      iss: "https://accounts.google.com",
      aud: "test-google-client-id",
      sub: claims.sub ?? `google-${claims.email}`,
      email: claims.email,
      email_verified: claims.emailVerified ?? true,
      name: claims.name ?? "Test member",
      iat: now,
      exp: now + 3600,
    }),
  );
  return `${header}.${payload}.test-signature`;
}

/** Sign in through Better Auth's real Google ID-token endpoint. */
export function signInWithGoogle(services: Services, claims: Parameters<typeof googleIdToken>[0]) {
  return request(services, "/api/auth/sign-in/social", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE_URL },
    body: JSON.stringify({ provider: "google", idToken: { token: googleIdToken(claims) } }),
  });
}
