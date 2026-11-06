// Node server build entry for the Playwright test host (BUILD_TARGET=node). Not used in production.
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createRequestHandler } from "react-router";
import { createRouterContext } from "../../app/context";
import { createServices, handleRequest } from "../../server/app";
import { loadConfig } from "../../server/config";
import * as schema from "../../server/db/schema";
import { FsMediaStore } from "./fs-media";

export function createNodeApp(env: Record<string, string | undefined>) {
  const sqlite = new Database(env.DATABASE_PATH ?? ".e2e/540daily.db");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: env.MIGRATIONS_DIR ?? "db/migrations" });

  // The Node host may build services once (unlike Workers).
  const services = createServices({
    config: loadConfig(env, "node"),
    db,
    media: new FsMediaStore(env.MEDIA_DIR ?? ".e2e/media"),
    fetchClientMetadata: fetchClientMetadataResource,
  });

  const renderPage = createRequestHandler(() => import("virtual:react-router/server-build"), "production");
  return (request: Request) => handleRequest(request, services, (req, svc) => renderPage(req, createRouterContext(svc)));
}
