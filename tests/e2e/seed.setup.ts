import { expect, test as setup } from "@playwright/test";

// Later lanes seed labeled test data through the running app here. Stage 0 only confirms the host is healthy.
setup("test host is healthy", async ({ request }) => {
  const response = await request.get("/health");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ ok: true, host: "node" });
});
