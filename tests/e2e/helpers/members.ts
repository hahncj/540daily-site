// Browser-test sign-in. Google cannot be used in tests, so this writes a test member and a Better Auth
// session straight into the test host's throwaway SQLite file and sets the signed session cookie.
// Every identity here is test data; nothing runs against a real database.
import { randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import Database from "better-sqlite3";
import { serializeSignedCookie } from "better-call";

const DB_PATH = ".e2e/540daily.db";
// Must match BETTER_AUTH_SECRET in playwright.config.ts (a test-only value).
const AUTH_SECRET = "e2e-test-secret-e2e-test-secret-1234";
const SESSION_COOKIE = "better-auth.session_token";

export type TestRole = "reader" | "editor" | "owner";

export async function signInAs(context: BrowserContext, baseURL: string, role: TestRole, label = role) {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const userId = randomUUID();
  const token = randomUUID().replace(/-/g, "");
  const now = Date.now();
  const db = new Database(DB_PATH);
  try {
    db.pragma("busy_timeout = 5000");
    db.prepare("insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)").run(userId, `Test ${label}`, email, now, now);
    db.prepare("insert into memberships (user_id, role, status, created_at, updated_at) values (?, ?, 'active', ?, ?)").run(userId, role, now, now);
    db.prepare("insert into session (id, expires_at, token, created_at, updated_at, user_id) values (?, ?, ?, ?, ?, ?)").run(
      randomUUID(),
      now + 60 * 60 * 1000,
      token,
      now,
      now,
      userId,
    );
  } finally {
    db.close();
  }
  const cookie = await serializeSignedCookie(SESSION_COOKIE, token, AUTH_SECRET);
  const value = cookie.split(";")[0]!.slice(SESSION_COOKIE.length + 1);
  await context.addCookies([{ name: SESSION_COOKIE, value, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
  return { userId, email, name: `Test ${label}` };
}
