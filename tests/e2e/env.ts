// Environment for the Playwright test host. All values are test-only placeholders.
// E2E_PORT lets two worktrees run browser tests at the same time.
export const E2E_PORT = Number(process.env.E2E_PORT ?? 4173);
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

export const E2E_ENV = {
  PORT: String(E2E_PORT),
  PUBLIC_BASE_URL: E2E_BASE_URL,
  OWNER_EMAIL: "owner@example.test",
  BETTER_AUTH_SECRET: "e2e-test-secret-e2e-test-secret-1234",
  GOOGLE_CLIENT_ID: "e2e-test-google-client-id",
  GOOGLE_CLIENT_SECRET: "e2e-test-google-client-secret",
  DATABASE_PATH: ".e2e/540daily.db",
  MEDIA_DIR: ".e2e/media",
};
