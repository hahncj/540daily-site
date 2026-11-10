// Browser-test sign-in. Google cannot be used in tests, so this writes a test member and a Better Auth
// session straight into the test host's throwaway SQLite file and sets the signed session cookie.
// Every identity here is test data; nothing runs against a real database.
import { randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import Database from "better-sqlite3";
import { serializeSignedCookie } from "better-call";
import config from "../../../playwright.config";

const DB_PATH = ".e2e/540daily.db";
// The test host's BETTER_AUTH_SECRET (a test-only value), read from the Playwright config.
const AUTH_SECRET = (config.webServer as { env: Record<string, string> }).env.BETTER_AUTH_SECRET!;
const SESSION_COOKIE = "better-auth.session_token";

export type TestRole = "reader" | "editor" | "owner";

export async function signInAs(context: BrowserContext, baseURL: string, role: TestRole, label: string = role) {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const userId = randomUUID();
  const now = Date.now();
  const db = new Database(DB_PATH);
  try {
    db.pragma("busy_timeout = 5000");
    db.prepare("insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)").run(userId, `Test ${label}`, email, now, now);
    db.prepare("insert into memberships (user_id, role, status, created_at, updated_at) values (?, ?, 'active', ?, ?)").run(userId, role, now, now);
  } finally {
    db.close();
  }
  await signInExisting(context, baseURL, userId);
  return { userId, email, name: `Test ${label}` };
}

/** A new session for an existing test member in another browser context: stands in for a second device. */
export async function signInExisting(context: BrowserContext, baseURL: string, userId: string) {
  const token = randomUUID().replace(/-/g, "");
  const now = Date.now();
  const db = new Database(DB_PATH);
  try {
    db.pragma("busy_timeout = 5000");
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
  await setSessionCookie(context, baseURL, token);
}

async function setSessionCookie(context: BrowserContext, baseURL: string, token: string) {
  const cookie = await serializeSignedCookie(SESSION_COOKIE, token, AUTH_SECRET);
  const value = cookie.split(";")[0]!.slice(SESSION_COOKIE.length + 1);
  await context.addCookies([{ name: SESSION_COOKIE, value, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
}
