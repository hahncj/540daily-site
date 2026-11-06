import { cimd } from "@better-auth/cimd";
import { mcp } from "@better-auth/mcp";
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import type { Database } from "../adapters/db";
import type { AppConfig } from "../config";
import { SIGN_IN_REFUSAL_MESSAGES } from "../core/access";
import type { Members } from "../core/members";
import * as schema from "../db/schema";

export const AUTH_BASE_PATH = "/api/auth";
export const MCP_PATH = "/mcp";
export const SESSION_COOKIE = "better-auth.session_token";
export const mcpResourceUrl = (config: Pick<AppConfig, "baseUrl">) => `${config.baseUrl}${MCP_PATH}`;

/**
 * Test-only seam: lets tests replace Google's ID-token signature check, so the real
 * sign-in path (provider → user info → membership gate → user and session creation) runs without Google.
 * Production hosts never pass this.
 */
export interface GoogleTestOverrides {
  verifyIdToken?: (token: string, nonce?: string) => Promise<boolean>;
}

export interface CreateAuthDeps {
  config: AppConfig;
  db: Database;
  members: Members;
  fetchClientMetadata: ClientMetadataResourceFetch;
  googleTestOverrides?: GoogleTestOverrides;
}

export function createAuth({ config, db, members, fetchClientMetadata, googleTestOverrides }: CreateAuthDeps) {
  return betterAuth({
    appName: "540 Daily",
    baseURL: config.baseUrl,
    basePath: AUTH_BASE_PATH,
    secret: config.authSecret,
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: config.google.clientId,
        clientSecret: config.google.clientSecret,
        overrideUserInfoOnSignIn: true,
        ...(googleTestOverrides?.verifyIdToken ? { verifyIdToken: googleTestOverrides.verifyIdToken } : {}),
      },
    },
    // The JWT plugin's session-to-JWT endpoint is not needed; MCP tokens come from the OAuth flow.
    disabledPaths: ["/token"],
    advanced: { ipAddress: { ipAddressHeaders: config.clientIpHeaders } },
    telemetry: { enabled: false },
    user: {
      // The membership gate: OWNER_EMAIL, an open invitation, or an existing active member.
      async validateUserInfo({ user, source }) {
        if (source.method !== "oauth" || source.oauth?.providerId !== "google") {
          return { error: "unsupported_sign_in", errorDescription: "Sign in with Google." };
        }
        const decision = await members.checkSignIn(String(user.email ?? ""), user.emailVerified === true);
        if (decision.allow) return;
        return { error: decision.reason, errorDescription: SIGN_IN_REFUSAL_MESSAGES[decision.reason] };
      },
    },
    databaseHooks: {
      user: {
        create: {
          async after(user) {
            await members.onUserCreated({ id: user.id, email: user.email, emailVerified: user.emailVerified });
          },
        },
      },
      session: {
        create: {
          // Defense in depth: no session for anyone who is not an active member.
          async before(session) {
            return (await members.allowSession(session.userId)) ? undefined : false;
          },
        },
      },
    },
    plugins: [
      jwt(),
      mcp({
        loginPage: "/sign-in",
        consentPage: "/consent",
        resource: mcpResourceUrl(config),
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultApplicationType: "infer",
      }),
      cimd({ fetchClientMetadataResource: fetchClientMetadata, metadataProfile: "mcp-2026-07-28" }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
