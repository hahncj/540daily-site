import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`app shell (${colorScheme})`, () => {
    test.use({ colorScheme });

    test("homepage renders the shell with category panels and hides categories with nothing recent", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("link", { name: "540 Daily" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Technology" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Entertainment" })).toHaveCount(0);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test("protected pages send visitors to sign-in", async ({ page }) => {
      await page.goto("/saved");
      await expect(page).toHaveURL(/\/sign-in\?next=%2Fsaved/);
      await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
    });
  });
}

test("visitors change the theme from Settings, saved on this device", async ({ page }) => {
  await page.goto("/");
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(header.getByRole("button", { name: /^Account menu/ })).toHaveCount(0);
  await header.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Auto/ })).toBeChecked();
  await page.getByRole("radio", { name: /^Dark/ }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("link", { name: "Sign in", exact: true }).last()).toBeVisible();
  // Kept on the device: the next page starts dark before scripts run.
  await page.goto("/categories");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("the old dashboard address goes to the home page", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/$/);
});

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
