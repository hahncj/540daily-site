// Lane 2B browser journeys: anonymous reading (A1), unpublished items vanishing (A8 public side),
// and search through the UI (A10). Data comes from seed.setup.ts and is labeled test data.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readSeed, type SeedInfo } from "./seed-info";

let seed: SeedInfo;
test.beforeAll(() => {
  seed = readSeed();
});

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`public pages (${colorScheme})`, () => {
    test.use({ colorScheme });

    test("A1: homepage panels show the newest items and pass axe", async ({ page }) => {
      await page.goto("/");
      const tech = page.getByRole("region", { name: "Technology" });
      await expect(tech.getByRole("listitem")).toHaveCount(5);
      await expect(tech.getByRole("link", { name: "Test data: pelican research report" })).toBeVisible();
      await expect(tech.getByRole("link", { name: "More in Technology" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Sports" }).getByText("Nothing published in Sports yet.")).toBeVisible();
      // The new category is not on the homepage until an editor selects it.
      await expect(page.getByRole("region", { name: "E2E Archive" })).toHaveCount(0);
      await expect(page.getByText("Test data: unpublished walrus story")).toHaveCount(0);
      await expectNoHorizontalScroll(page);
      await expectAccessible(page);
    });

    test("A1: detail page shows body, image, sources, and related items", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("link", { name: "Test data: pelican research report" }).click();
      await expect(page).toHaveURL(seed.visibleReport.path);
      await expect(page.getByRole("heading", { level: 1, name: seed.visibleReport.title })).toBeVisible();
      await expect(page.getByText("E2E Editor via E2E research agent")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Findings" })).toBeVisible();
      const image = page.getByRole("img", { name: "Test data chart" });
      await expect(image).toBeVisible();
      expect(await image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      await expect(page.getByRole("link", { name: "Example source (test data)" })).toHaveAttribute("rel", /nofollow/);
      await expect(page.getByRole("region", { name: "More in Technology" }).getByRole("listitem")).toHaveCount(5);
      await expectNoHorizontalScroll(page);
      await expectAccessible(page);
    });

    test("A1: categories directory and a paginated, filterable category page", async ({ page }) => {
      await page.goto("/categories");
      await expect(page.getByRole("link", { name: "E2E Archive" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Drafts Only" })).toHaveCount(0);
      await expectAccessible(page);

      await page.getByRole("link", { name: "E2E Archive" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "E2E Archive" })).toBeVisible();
      await expect(page.getByRole("main").getByRole("listitem").filter({ has: page.getByRole("heading") })).toHaveCount(20);
      await expect(page.getByText("Page 1 of 2")).toBeVisible();
      await page.getByRole("link", { name: "Next page" }).click();
      await expect(page).toHaveURL(/page=2/);
      await expect(page.getByText("Page 2 of 2")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Test data: archive item 1", exact: true })).toBeVisible();

      await page.getByRole("navigation", { name: "Publication type" }).getByRole("link", { name: "Reports" }).click();
      await expect(page).toHaveURL(/type=report/);
      await expect(page.getByRole("link", { name: "Reports" })).toHaveAttribute("aria-current", "page");
      await expect(page.getByText("Page 1 of 1")).toHaveCount(0); // 7 reports fit on one page: no pager
      await expectAccessible(page);
    });

    test("A10: search with keywords and filters, with the date-basis note", async ({ page }) => {
      await page.goto("/search");
      await expect(page.getByText("in Central Time (America/Chicago)")).toBeVisible();
      await expectAccessible(page);

      await page.getByLabel("Keywords").fill("pelican");
      await page.getByRole("button", { name: "Search" }).click();
      await expect(page).toHaveURL(/q=pelican/);
      await expect(page.getByRole("status")).toHaveText("3 results for “pelican”");

      await page.getByLabel("Category").selectOption({ label: "Business" });
      await page.getByRole("button", { name: "Search" }).click();
      await expect(page).toHaveURL(/category=business/);
      await expect(page.getByRole("status")).toHaveText("2 results for “pelican”");

      await page.getByLabel("To").fill("2025-12-31");
      await page.getByRole("button", { name: "Search" }).click();
      await expect(page).toHaveURL(/to=2025-12-31/);
      await expect(page.getByRole("status")).toHaveText("1 result for “pelican”");
      await expect(page.getByRole("link", { name: "Test data: archived pelican story" })).toBeVisible();

      await page.getByRole("link", { name: "Clear" }).click();
      await expect(page).toHaveURL(/\/search$/);
      await expect(page.getByLabel("To")).toHaveValue("");
      await expect(page.getByLabel("Category")).toHaveValue("");
      await page.getByLabel("Keywords").fill("pelican");
      await page.getByLabel("Type").selectOption({ label: "Reports" });
      await page.getByRole("button", { name: "Search" }).click();
      await expect(page).toHaveURL(/type=report/);
      await expect(page.getByRole("status")).toHaveText("1 result for “pelican”");
      await expect(page.getByRole("link", { name: "Test data: pelican research report" })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectAccessible(page);
    });

    test("A10: an invalid date range shows a field error and keeps the input", async ({ page }) => {
      await page.goto("/search?q=pelican&from=2026-11-05&to=2026-11-01");
      await expect(page.getByText("The end date is before the start date.")).toBeVisible();
      await expect(page.getByLabel("To")).toHaveAttribute("aria-invalid", "true");
      await expect(page.getByLabel("Keywords")).toHaveValue("pelican");
      await expectAccessible(page);
    });
  });
}

test.describe("A8 (public side): unpublished and draft items are invisible", () => {
  test("detail pages are not found and look the same as unknown IDs", async ({ page }) => {
    for (const path of [seed.hidden.path, seed.draft.path, "/publications/does-not-exist"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
      await expect(page.getByText("walrus")).toHaveCount(0);
    }
  });

  test("search, categories, and the sitemap never show them", async ({ page, request }) => {
    await page.goto("/search?q=walrus");
    await expect(page.getByRole("status")).toHaveText("No results");
    await page.goto("/search?q=narwhal");
    await expect(page.getByRole("status")).toHaveText("No results");
    await page.goto("/categories/technology");
    await expect(page.getByText("walrus")).toHaveCount(0);
    expect((await page.goto("/categories/drafts-only"))?.status()).toBe(404);
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain(seed.visibleReport.id);
    expect(sitemap).not.toContain(seed.hidden.id);
    expect(sitemap).not.toContain(seed.draft.id);
  });

  test("the hidden item's attachment is blocked while the visible one is served", async ({ request }) => {
    const visible = await request.get(`/attachments/${seed.visibleReport.attachmentId}`);
    expect(visible.status()).toBe(200);
    expect(visible.headers()["content-type"]).toBe("image/png");
    expect(visible.headers()["cache-control"]).toBe("public, max-age=300");
    const hidden = await request.get(`/attachments/${seed.hidden.attachmentId}`);
    expect(hidden.status()).toBe(404);
    expect(hidden.headers()["cache-control"]).toBe("no-store");
  });
});

// Agent write endpoints: 503 until lane 2A builds them, 401 after. Page actions are checked in Vitest.
test("A1: protected writes fail without authentication", async ({ request }) => {
  const json = { "Content-Type": "application/json" };
  const attempts = [
    request.post("/api/v1/publications", { headers: json, data: { externalId: "e2e-anon", type: "story", title: "x", summary: "x", category: "x" } }),
    request.post("/mcp", { headers: json, data: { jsonrpc: "2.0", id: 1, method: "tools/list" } }),
  ];
  for (const response of await Promise.all(attempts)) {
    expect(response.status(), response.url()).toBeGreaterThanOrEqual(400);
  }
});

test("public pages are indexable and private pages are not", async ({ request }) => {
  for (const path of ["/", "/categories", "/search", seed.visibleReport.path]) {
    expect((await request.get(path)).headers()["x-robots-tag"], path).toBeUndefined();
  }
  expect((await request.get("/sign-in")).headers()["x-robots-tag"]).toBe("noindex");
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Sitemap: http://localhost:4173/sitemap.xml");
});
