import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`app shell (${colorScheme})`, () => {
    test.use({ colorScheme });

    test("homepage renders the shell with category panels and honest empty panels", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("link", { name: "540 Daily" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Entertainment" }).getByText("Nothing published in Entertainment yet.")).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test("protected pages send visitors to sign-in", async ({ page }) => {
      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard/);
      await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
    });
  });
}

test("header sign-in goes straight to Google", async ({ page }) => {
  // Stand-in for Google's sign-in page (test only): no request leaves the machine.
  await page.route("https://accounts.google.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>Google stand-in</title>" }));
  await page.goto("/categories");
  await page.waitForLoadState("networkidle");
  await page.getByRole("banner").getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/^https:\/\/accounts\.google\.com\//);
  const state = new URL(page.url());
  expect(state.searchParams.get("client_id")).toBe("e2e-test-google-client-id");
  expect(state.searchParams.get("redirect_uri")).toMatch(/\/api\/auth\/callback\/google$/);
});
