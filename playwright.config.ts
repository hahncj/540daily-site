import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL as BASE_URL, E2E_ENV } from "./tests/e2e/env";

// Browser tests run against the Node build (BUILD_TARGET=node) with a throwaway SQLite file in .e2e/.
// All values below are test-only placeholders.
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    { name: "phone-chromium", use: { ...devices["Pixel 7"] }, dependencies: ["setup"] },
    { name: "phone-webkit", use: { ...devices["iPhone 15"] }, dependencies: ["setup"] },
    { name: "tablet", use: { ...devices["iPad (gen 7)"] }, dependencies: ["setup"] },
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
  ],
  webServer: {
    command: "rm -rf .e2e && mkdir -p .e2e && npm run build:node && npm run start:node",
    url: `${BASE_URL}/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: E2E_ENV,
  },
});
