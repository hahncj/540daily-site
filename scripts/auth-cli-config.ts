// Dummy configuration so the Better Auth CLI can build server/db/auth-schema.ts.
// It uses the real createAuth(), so the generated tables always match the plugins in use. No real secrets here.
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createAuth } from "../server/auth/auth";
import { fetchClientMetadataViaFetch } from "../server/auth/cimd-fetch";
import { loadConfig } from "../server/config";
import { createMembers, type MembersRepository } from "../server/core/members";
import * as schema from "../server/db/schema";

const config = loadConfig(
  {
    PUBLIC_BASE_URL: "http://localhost:5173",
    OWNER_EMAIL: "owner@example.test",
    BETTER_AUTH_SECRET: "auth-cli-placeholder-secret-not-used-anywhere",
    GOOGLE_CLIENT_ID: "placeholder",
    GOOGLE_CLIENT_SECRET: "placeholder",
  },
  "node",
);

const unusedRepo = new Proxy({} as MembersRepository, {
  get() {
    throw new Error("The auth CLI config does not touch membership data.");
  },
});

export const auth = createAuth({
  config,
  db: drizzle(new Database(":memory:"), { schema }),
  members: createMembers({ repo: unusedRepo, ownerEmail: config.ownerEmail, now: () => new Date(), newId: () => crypto.randomUUID() }),
  fetchClientMetadata: fetchClientMetadataViaFetch,
});
