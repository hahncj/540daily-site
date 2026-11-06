import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "build/",
      ".react-router/",
      ".wrangler/",
      ".e2e/",
      "node_modules/",
      "playwright-report/",
      "test-results/",
      "hosting/cloudflare/worker-configuration.d.ts",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Core holds pure business rules. It may import only zod and other core files.
    files: ["server/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["cloudflare:*", "@cloudflare/*", "wrangler"], message: "core must not import Cloudflare APIs." },
            { group: ["react-router", "@react-router/*", "react", "react-dom", "react/*", "react-dom/*"], message: "core must not import UI code." },
            { group: ["better-sqlite3", "drizzle-orm", "drizzle-orm/*"], message: "core must use repository interfaces." },
            { group: ["better-auth", "better-auth/*", "@better-auth/*", "@modelcontextprotocol/*", "better-call"], message: "core must not import provider SDKs." },
            { group: ["**/hosting/**", "**/adapters/**", "**/auth/**", "**/db/**", "**/mcp/**", "node:*"], message: "core must not import hosts, adapters, auth, schema, MCP, or Node APIs." },
            { group: ["markdown-it", "markdown-it/*", "xss"], message: "core defines the Markdown interface; the renderer lives in adapters." },
          ],
        },
      ],
    },
  },
);
