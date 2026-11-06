import { drizzle } from "drizzle-orm/d1";
import { createRequestHandler } from "react-router";
import { createRouterContext } from "../../app/context";
import { createServices, handleRequest, type Services } from "../../server/app";
import { fetchClientMetadataViaFetch } from "../../server/auth/cimd-fetch";
import { loadConfig, type AppConfig } from "../../server/config";
import * as schema from "../../server/db/schema";
import { R2MediaStore } from "./r2-media";

// The only file that reads Worker bindings and environment values.

const renderPage = createRequestHandler(() => import("virtual:react-router/server-build"), import.meta.env.MODE);

/** Only plain, parsed config is cached per isolate. */
const configByEnv = new WeakMap<Env, AppConfig>();
function getConfig(env: Env): AppConfig {
  let config = configByEnv.get(env);
  if (!config) {
    config = loadConfig(env as unknown as Record<string, unknown>, "cloudflare");
    configByEnv.set(env, config);
  }
  return config;
}

// Built per request on purpose: never cache Services or the Better Auth instance on Workers.
// Reusing a Better Auth instance across requests caused intermittent sign-in hangs in an earlier app.
function buildServices(env: Env): Services {
  return createServices({
    config: getConfig(env),
    db: drizzle(env.DB, { schema }),
    media: new R2MediaStore(env.MEDIA),
    fetchClientMetadata: fetchClientMetadataViaFetch,
  });
}

export default {
  async fetch(request, env) {
    return handleRequest(request, buildServices(env), (req, services) => renderPage(req, createRouterContext(services)));
  },
} satisfies ExportedHandler<Env>;
