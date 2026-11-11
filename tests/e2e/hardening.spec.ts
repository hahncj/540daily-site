// Stage 4 (A12) journeys on phone, tablet, and desktop: keyboard-only reading, bookmarking, and editing;
// visible focus; an explicit theme choice that overrides the device theme; error and empty states; and
// reduced motion. Panel reordering by keyboard is covered in editor.spec.ts and reader.spec.ts.
// Every member and publication here is labeled test data.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { signInAs } from "./helpers/members";
import { readSeed, type SeedInfo } from "./seed-info";

let seed: SeedInfo;
test.beforeAll(() => {
  seed = readSeed();
});

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

/**
 * Press Tab until `target` has focus, the way a keyboard user would reach it. WebKit's Tab skips links
 * unless the "Tab to every item" preference is on, so it uses Alt+Tab, Safari's key for that.
 */
async function tabTo(page: Page, target: Locator, browserName: string, max = 60) {
  const key = browserName === "webkit" ? "Alt+Tab" : "Tab";
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(key);
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
  }
  throw new Error(`Could not reach ${target} with the keyboard in ${max} presses.`);
}

/** A visible focus indicator: the :focus-visible outline from app.css. */
async function expectVisibleFocus(target: Locator) {
  const outline = await target.evaluate((el) => {
    const s = getComputedStyle(el);
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
  });
  expect(outline.style).not.toBe("none");
  expect(outline.width).toBeGreaterThanOrEqual(2);
}

/** Relative luminance of the page background, 0 (black) to 1 (white). */
async function backgroundLuminance(page: Page) {
  return page.evaluate(() => {
    const m = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g)!.map(Number);
    const [r, g, b] = m.slice(0, 3).map((c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`keyboard journeys (${colorScheme} device theme)`, () => {
    test.use({ colorScheme });

    test("A12: skip link, search, and opening a result with the keyboard only", async ({ page, browserName }) => {
      await page.goto("/");
      const skip = page.getByRole("link", { name: "Skip to content" });
      await tabTo(page, skip, browserName, 3);
      await expect(skip).toBeInViewport();
      await expectVisibleFocus(skip);
      await page.keyboard.press("Enter");
      await expect(page.locator("#main")).toBeFocused();

      const searchLink = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Search" });
      await tabTo(page, searchLink, browserName);
      await expectVisibleFocus(searchLink);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/search$/);

      const keywords = page.getByLabel("Keywords");
      await tabTo(page, keywords, browserName);
      await page.keyboard.type(seed.visibleReport.title);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/search\?q=/);

      const result = page.locator("main").getByRole("link", { name: seed.visibleReport.title, exact: true }).first();
      await tabTo(page, result, browserName);
      await expectVisibleFocus(result);
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { level: 1, name: seed.visibleReport.title })).toBeVisible();
      await expectAccessible(page);
    });

    test("A12: a reader saves and unsaves a story with the keyboard", async ({ page, context, baseURL, browserName }) => {
      await signInAs(context, baseURL!, "reader", "keyboard-reader");
      await page.goto(seed.visibleReport.path);
      const save = page.getByRole("button", { name: `Save ${seed.visibleReport.title}`, exact: true }).first();
      await tabTo(page, save, browserName);
      await expectVisibleFocus(save);
      const saved = page.waitForResponse((r) => new URL(r.url()).pathname.startsWith("/saved") && r.request().method() === "POST");
      await page.keyboard.press("Enter");
      expect((await saved).ok()).toBe(true);
      await expect(save).toHaveAttribute("aria-pressed", "true");

      await page.goto("/saved");
      await expect(page.locator("main").getByRole("link", { name: seed.visibleReport.title })).toBeVisible();
      const unsave = page.getByRole("button", { name: `Save ${seed.visibleReport.title}`, exact: true }).first();
      await tabTo(page, unsave, browserName);
      const removed = page.waitForResponse((r) => new URL(r.url()).pathname.startsWith("/saved") && r.request().method() === "POST");
      await page.keyboard.press("Enter");
      expect((await removed).ok()).toBe(true);
      // The saved list may drop the item as soon as it revalidates, so check the stored state instead.
      await page.goto("/saved");
      await expect(page.locator("main").getByRole("link", { name: seed.visibleReport.title })).toHaveCount(0);
    });

    test("A12: an editor edits and saves a draft with the keyboard", async ({ page, context, baseURL, browserName }) => {
      await signInAs(context, baseURL!, "editor", "keyboard-editor");
      await page.goto("/editor/new");
      const title = `Test keyboard draft ${Date.now()}`;
      const fields: Array<[string, string]> = [
        ["Title", title],
        ["Summary", "Summary typed with the keyboard (test data)."],
        ["Category", "E2E Keyboard Tests"],
      ];
      for (const [label, text] of fields) {
        const field = page.getByLabel(label, { exact: true });
        await tabTo(page, field, browserName);
        await expectVisibleFocus(field);
        await page.keyboard.type(text);
      }
      const saveDraft = page.getByRole("button", { name: "Save draft" });
      await tabTo(page, saveDraft, browserName);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/editor\/publications\/[^/?]+\?done=created$/);
      await expect(page.getByText("Draft saved.")).toBeVisible();

      const titleField = page.getByLabel("Title", { exact: true });
      await tabTo(page, titleField, browserName);
      await page.keyboard.press("ArrowRight"); // Tabbing in selects the text; this moves the caret to the end.
      await page.keyboard.type(" (edited)");
      const save = page.getByRole("button", { name: "Save", exact: true });
      await tabTo(page, save, browserName);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\?done=saved$/);
      await expect(page.getByText("Changes saved.")).toBeVisible();
      await page.reload();
      await expect(page.getByLabel("Title", { exact: true })).toHaveValue(`${title} (edited)`);
    });
  });
}

test.describe("A12: an explicit theme overrides the device theme", () => {
  for (const [device, chosen] of [
    ["light", "dark"],
    ["dark", "light"],
  ] as const) {
    test.describe(`${device} device`, () => {
      test.use({ colorScheme: device });

      test(`a visitor picks ${chosen}; it applies, passes axe, and survives a reload`, async ({ page, browserName }) => {
        // Wait for hydration, so the select's change handler is attached.
        await page.goto("/", { waitUntil: "networkidle" });
        const before = await backgroundLuminance(page);
        const select = page.getByLabel("Color theme");
        await tabTo(page, select, browserName);
        await expectVisibleFocus(select);
        await select.selectOption(chosen);
        await expect(page.locator("html")).toHaveAttribute("data-theme", chosen);
        const after = await backgroundLuminance(page);
        if (chosen === "dark") expect(after).toBeLessThan(before);
        else expect(after).toBeGreaterThan(before);
        await expectAccessible(page);

        await page.goto(seed.visibleReport.path);
        await expect(page.locator("html")).toHaveAttribute("data-theme", chosen);
        await expectAccessible(page);
        await page.reload();
        await expect(page.locator("html")).toHaveAttribute("data-theme", chosen);
      });
    });
  }
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`error and empty states (${colorScheme})`, () => {
    test.use({ colorScheme });

    test("A12: unknown pages and items show a usable not-found page", async ({ page, browserName }) => {
      for (const path of ["/no-such-page", "/publications/no-such-item", "/categories/no-such-category"]) {
        const response = await page.goto(path);
        expect(response?.status(), path).toBe(404);
        await expect(page.getByRole("heading", { level: 1, name: "Not found" })).toBeVisible();
        await expect(page).toHaveTitle("Not found · 540 Daily");
        await expectAccessible(page);
      }
      const home = page.getByRole("link", { name: "Go to the homepage" });
      await tabTo(page, home, browserName);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/$/);
    });

    test("A12: a search with no matches and an empty panel explain themselves", async ({ page }) => {
      await page.goto("/search?q=zzqxnomatchzzqx");
      await expect(page.locator("main")).toContainText(/no (results|publications|matches)/i);
      await expectAccessible(page);

      await page.goto("/");
      const empty = page.locator(".category-panel").filter({ has: page.getByRole("heading", { name: "Entertainment" }) });
      await expect(empty).toContainText(/nothing|no /i);
      await expectAccessible(page);
    });

    test("A12: the sign-in page passes axe and fits the screen", async ({ page }) => {
      await page.goto("/sign-in");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectAccessible(page);
    });
  });
}

test("pages hydrate without errors in every browser", async ({ page, context, baseURL }) => {
  // A server/browser text mismatch (for example engine-specific date text) makes React throw away the
  // server HTML, which drops a visitor's theme and costs a full re-render.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
  const visit = async (path: string) => {
    await page.goto(path, { waitUntil: "networkidle" });
  };
  for (const path of ["/", "/categories", `/categories/${seed.archiveCategory.slug}`, seed.visibleReport.path, "/search?q=test", "/sign-in"]) await visit(path);
  await signInAs(context, baseURL!, "owner", "hydration-owner");
  for (const path of ["/dashboard", "/saved", "/editor", "/editor/homepage", `/editor/publications/${seed.visibleReport.id}`, "/account", "/owner"]) await visit(path);
  expect(errors).toEqual([]);
});

test.describe("A12: reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("transitions are effectively off when the device asks for less motion", async ({ page }) => {
    await page.goto("/");
    const duration = await page
      .locator(".button")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration) || 0);
    expect(duration).toBeLessThanOrEqual(0.001);
  });
});
