// Node test host for Playwright. Serves the BUILD_TARGET=node build. Not a production server.
import { createRequestListener } from "@remix-run/node-fetch-server";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const { createNodeApp } = await import(path.resolve("build/server/index.js"));
const handle = createNodeApp(process.env);
const clientDir = path.resolve("build/client");
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };

async function serveStatic(request) {
  const url = new URL(request.url);
  if (request.method !== "GET" || !url.pathname.startsWith("/assets/")) return null;
  const file = path.resolve(clientDir, "." + url.pathname);
  if (!file.startsWith(clientDir + path.sep)) return null;
  try {
    const body = await readFile(file);
    const type = TYPES[path.extname(file)] ?? "application/octet-stream";
    return new Response(body, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" } });
  } catch {
    return null;
  }
}

const port = Number(process.env.PORT ?? 4173);
http
  .createServer(createRequestListener(async (request) => (await serveStatic(request)) ?? handle(request)))
  .listen(port, () => console.log(`540 Daily test host on http://localhost:${port}`));
