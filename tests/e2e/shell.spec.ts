import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`app shell (${colorScheme})`, () => {
    test.use({ colorScheme });

    test("homepage renders the shell with an honest empty state", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("link", { name: "540 News" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
      await expect(page.getByText("No stories have been published yet.")).toBeVisible();
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
