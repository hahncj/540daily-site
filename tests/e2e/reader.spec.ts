// Lane 3B reader features in a real browser: A9 (personal dashboard, interests, theme, and bookmarks
// persist across devices without changing the public layout), A3 (readers cannot see each other's data),
// keyboard panel reordering, the unavailable-bookmark placeholder, and axe checks in both themes.
// Every member and publication here is labeled test data.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContextOptions, type Page, type TestInfo } from "@playwright/test";
import { signInAs, signInExisting } from "./helpers/members";
import { readSeed, type SeedInfo } from "./seed-info";

let seed: SeedInfo;
test.beforeAll(() => {
  seed = readSeed();
});

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  // Phone, tablet, and desktop layouts: no sideways scrolling.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

/** Another browser on the same kind of device: stands in for the member's second device. */
async function newDevice(browser: Browser, testInfo: TestInfo, baseURL: string, extra: BrowserContextOptions = {}) {
  const u = testInfo.project.use;
  return browser.newContext({
    baseURL,
    viewport: u.viewport,
    userAgent: u.userAgent,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
    ...extra,
  });
}

const panelTitles = (page: Page) => page.locator(".category-panel__title");

/** Click and wait until the server answered the post, so the next step sees the saved state. */
async function clickAndWaitForPost(page: Page, path: string, click: () => Promise<void>) {
  const answered = page.waitForResponse((r) => new URL(r.url()).pathname.startsWith(path) && r.request().method() === "POST");
  await click();
  expect((await answered).ok()).toBe(true);
}

test("A9: dashboard, interests, theme, and bookmarks follow the member to another device", async ({ page, context, baseURL, browser }, testInfo) => {
  await page.goto("/");
  const publicOrder = await panelTitles(page).allTextContents();
  expect(publicOrder).toContain("Technology");
  const member = await signInAs(context, baseURL!, "reader");

  // First visit: the personal dashboard starts from the public layout.
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "My dashboard" })).toBeVisible();
  await expect(panelTitles(page)).toHaveText(publicOrder);

  // Keyboard reordering keeps focus on the moved panel's button.
  const first = publicOrder[0]!;
  await page.getByRole("button", { name: `Move down ${first}`, exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: `${first} moved down to position 2` })).toBeAttached();
  await expect(page.getByRole("button", { name: `Move down ${first}`, exact: true })).toBeFocused();

  // Remove one panel and add a category that is not on the public homepage.
  const removed = publicOrder.find((n) => n !== "Technology" && n !== first)!;
  await page.getByRole("button", { name: `Remove ${removed} from my dashboard` }).click();
  await expect(page.getByRole("region", { name: removed, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: `Add ${seed.archiveCategory.name} to my dashboard` }).click();
  await expect(page.getByRole("region", { name: seed.archiveCategory.name })).toBeVisible();
  const expectedOrder = [publicOrder[1]!, first, ...publicOrder.slice(2)].filter((n) => n !== removed).concat(seed.archiveCategory.name);
  await expect(panelTitles(page)).toHaveText(expectedOrder);

  // Interest filter: only items tagged "e2e" (the six seeded technology stories) remain.
  await page.getByRole("checkbox", { name: "e2e" }).check();
  await page.getByRole("button", { name: "Save interests" }).click();
  await expect(page.getByText("Showing only items tagged e2e.")).toBeVisible();
  const tech = page.getByRole("region", { name: "Technology" });
  await expect(tech.getByRole("link", { name: seed.visibleReport.title })).toHaveCount(0);
  await expect(tech.getByRole("listitem")).toHaveCount(5);
  await expect(tech.getByRole("heading", { name: /^Test data: technology story \d$/ })).toHaveCount(5);
  await expect(page.getByRole("region", { name: seed.archiveCategory.name }).getByText("Nothing in E2E Archive matches your interests yet.")).toBeVisible();

  // Theme saved to the account.
  await clickAndWaitForPost(page, "/dashboard", async () => {
    await page.getByLabel("Color theme").selectOption("dark");
  });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // Bookmark from the detail page.
  await page.goto(seed.visibleReport.path);
  const save = page.getByRole("button", { name: `Save ${seed.visibleReport.title}`, exact: true });
  await expect(save).toHaveAttribute("aria-pressed", "false");
  await clickAndWaitForPost(page, "/saved", () => save.click());
  await expect(save).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(save).toHaveAttribute("aria-pressed", "true");

  // A second device sees the same dashboard, interests, theme (rendered by the server), and bookmark.
  const other = await newDevice(browser, testInfo, baseURL!);
  try {
    await signInExisting(other, baseURL!, member.userId);
    const p2 = await other.newPage();
    await p2.goto("/dashboard");
    await expect(p2.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(p2.getByLabel("Color theme")).toHaveValue("dark");
    await expect(panelTitles(p2)).toHaveText(expectedOrder);
    await expect(p2.getByText("Showing only items tagged e2e.")).toBeVisible();
    await p2.goto("/saved");
    await expect(p2.getByRole("link", { name: seed.visibleReport.title })).toBeVisible();
  } finally {
    await other.close();
  }

  // The public homepage did not change.
  const anonymous = await newDevice(browser, testInfo, baseURL!);
  try {
    const p3 = await anonymous.newPage();
    await p3.goto("/");
    await expect(panelTitles(p3)).toHaveText(publicOrder);
    await expect(p3.getByRole("button", { name: /^Save / })).toHaveCount(0);
  } finally {
    await anonymous.close();
  }
});

test("A3 and placeholder: another reader sees none of it, and an unpublished bookmark shows as unavailable", async ({ page, context, baseURL, browser }, testInfo) => {
  // An editor publishes a fresh test item in its own category, so other journeys are unaffected.
  const editorContext = await newDevice(browser, testInfo, baseURL!);
  const editor = await editorContext.newPage();
  const title = `Test data: reader bookmark story ${Date.now()}`;
  try {
    await signInAs(editorContext, baseURL!, "editor");
    await editor.goto("/editor/new");
    await editor.getByLabel("Title").fill(title);
    await editor.getByLabel("Summary").fill("Summary written by a browser test (test data).");
    await editor.getByLabel("Category").fill("E2E Reader");
    await editor.getByLabel("Body (Markdown)").fill("Body written by a browser test (test data).");
    await editor.getByRole("button", { name: "Save draft" }).click();
    await expect(editor).toHaveURL(/\?done=created$/);
    await editor.getByRole("button", { name: "Save and publish" }).click();
    await expect(editor.getByText("Published. It is now on the public site.")).toBeVisible();
    const publicPath = (await editor.getByRole("link", { name: "View public page" }).getAttribute("href"))!;

    // Reader A saves it.
    await signInAs(context, baseURL!, "reader", "reader-a");
    await page.goto(publicPath);
    const save = page.getByRole("button", { name: `Save ${title}`, exact: true });
    await clickAndWaitForPost(page, "/saved", () => save.click());
    await expect(save).toHaveAttribute("aria-pressed", "true");

    // Reader B sees nothing of A's.
    const readerB = await newDevice(browser, testInfo, baseURL!);
    try {
      await signInAs(readerB, baseURL!, "reader", "reader-b");
      const b = await readerB.newPage();
      await b.goto("/saved");
      await expect(b.getByText("Nothing saved yet.")).toBeVisible();
      await b.goto(publicPath);
      await expect(b.getByRole("button", { name: `Save ${title}`, exact: true })).toHaveAttribute("aria-pressed", "false");
    } finally {
      await readerB.close();
    }

    // The editor unpublishes it: A's saved list shows a generic placeholder without the title.
    await editor.getByRole("button", { name: "Unpublish" }).click();
    await expect(editor.getByText(/^Unpublished\./)).toBeVisible();
    await page.goto("/saved");
    await expect(page.getByRole("heading", { name: "Unavailable item" })).toBeVisible();
    await expect(page.getByText("This item is no longer available.")).toBeVisible();
    await expect(page.getByText(title)).toHaveCount(0);
    expect(await page.content()).not.toContain(title);
    await expectAccessible(page);

    await page.getByRole("button", { name: /^Remove unavailable item/ }).click();
    await expect(page.getByText("Nothing saved yet.")).toBeVisible();
    // Focus moves to the heading instead of being lost with the removed item.
    await expect(page.getByRole("heading", { level: 1, name: "Saved" })).toBeFocused();
  } finally {
    await editorContext.close();
  }
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`reader pages (${colorScheme})`, () => {
    test.use({ colorScheme });

    test("dashboard, saved list, and save buttons pass axe and fit the screen", async ({ page, context, baseURL }) => {
      await signInAs(context, baseURL!, "reader");
      await page.goto(seed.visibleReport.path);
      await clickAndWaitForPost(page, "/saved", () => page.getByRole("button", { name: `Save ${seed.visibleReport.title}`, exact: true }).click());
      await expectAccessible(page);

      await page.goto("/");
      await expect(page.getByRole("button", { name: `Save ${seed.visibleReport.title}`, exact: true })).toHaveAttribute("aria-pressed", "true");
      await expectAccessible(page);

      await page.goto("/dashboard");
      await expect(page.getByRole("heading", { name: "Customize" })).toBeVisible();
      await expectAccessible(page);

      await page.goto("/saved");
      await expect(page.getByRole("link", { name: seed.visibleReport.title })).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
      await expectAccessible(page);
    });
  });
}
