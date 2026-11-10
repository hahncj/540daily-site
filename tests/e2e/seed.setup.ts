import { expect, test as setup } from "@playwright/test";
import { E2E_ENV } from "./env";
import { seedTestData } from "./seed-data";

setup("test host is healthy", async ({ request }) => {
  const response = await request.get("/health");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ ok: true, host: "node" });
});

// Labeled test data, written through the core services into the test host's database.
setup("seed public reading test data", async () => {
  await seedTestData(E2E_ENV);
});
