import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

// BUILD_TARGET=cloudflare (default): the app runs in workerd through the Cloudflare plugin.
// BUILD_TARGET=node: a Node server build used only by the Playwright test host.
const target = process.env.BUILD_TARGET === "node" ? "node" : "cloudflare";

export default defineConfig(() => ({
  plugins: [
    target === "cloudflare"
      ? cloudflare({
          configPath: "./hosting/cloudflare/wrangler.jsonc",
          viteEnvironment: { name: "ssr" },
          persistState: { path: ".wrangler/state" },
        })
      : null,
    reactRouter(),
  ],
  // React Router reads a custom server entry from the ssr environment's build input.
  environments:
    target === "node" ? { ssr: { build: { rollupOptions: { input: "./hosting/node/app.ts" } } } } : undefined,
}));
