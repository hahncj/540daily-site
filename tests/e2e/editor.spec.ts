// Editor workspace in a real browser (lane 2C): A14 end to end, A7 conflict handling in the UI,
// keyboard reordering of homepage panels, access, and axe checks in both themes.
// All publications created here are labeled test data.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./helpers/members";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  // Phone, tablet, and desktop layouts: no sideways scrolling.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

async function createDraft(page: Page, title: string) {
  await page.goto("/editor/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Summary").fill("Summary written by a browser test (test data).");
  await page.getByLabel("Category").fill("Technology");
  await page.getByLabel("Body (Markdown)").fill("## Test heading\n\nBody written by a browser test (test data).");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Draft saved." })).toBeVisible();
  return page.url();
}

test.describe("editor access", () => {
  test("visitors are sent to sign-in and readers are refused", async ({ page, context, baseURL }) => {
    await page.goto("/editor/new");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Feditor%2Fnew/);
    await signInAs(context, baseURL!, "reader");
    const response = await page.goto("/editor");
    expect(response?.status()).toBe(403);
    expect(response?.headers()["x-robots-tag"]).toBe("noindex");
    await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
  });
});

test.describe("A14: editor workflow end to end", () => {
  test("create, preview, publish, edit, unpublish, restore, history, and upload", async ({ page, context, baseURL }) => {
    await signInAs(context, baseURL!, "editor");
    const title = `Test browser story ${Date.now()}`;

    await page.goto("/editor/new");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Summary").fill("Summary written by a browser test (test data).");
    await page.getByLabel("Category").fill("Technology");
    await page.getByLabel("Body (Markdown)").fill("## Test heading\n\n<script>alert(1)</script> Body text (test data).");

    // Preview renders on the server, safely, and keeps the input.
    await page.getByRole("button", { name: "Preview" }).click();
    const preview = page.getByRole("region", { name: "Preview" });
    await expect(preview.getByRole("heading", { name: "Test heading" })).toBeVisible();
    await expect(preview).toContainText("<script>alert(1)</script>");
    await expect(page.getByLabel("Title")).toHaveValue(title);

    // Upload an image and insert its Markdown into the body.
    await page.getByLabel("Image file").setInputFiles({ name: "chart.png", mimeType: "image/png", buffer: PNG });
    await page.getByLabel("Alt text").fill("Test chart");
    await page.getByRole("button", { name: "Upload image" }).click();
    await expect(page.getByText(/Uploaded\. Markdown:/)).toBeVisible();
    await page.getByRole("button", { name: "Insert into body" }).click();
    await expect(page.getByLabel("Body (Markdown)")).toHaveValue(/!\[Test chart\]\(attachment:[A-Za-z0-9_-]+\)/);

    // Save a private draft.
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL(/\/editor\/publications\/[^/?]+\?done=created$/);
    await expect(page.getByText("Draft saved.")).toBeVisible();
    await expect(page.getByLabel("Body (Markdown)")).toHaveValue(/attachment:/);
    const editUrl = page.url().replace(/\?.*$/, "");

    // Edit and publish in one step.
    await page.getByLabel("Title").fill(`${title} (edited)`);
    await page.getByRole("button", { name: "Save and publish" }).click();
    await expect(page.getByText("Published. It is now on the public site.")).toBeVisible();
    await expect(page.getByRole("link", { name: "View public page" })).toBeVisible();

    // Unpublish, then restore visibility.
    await page.getByRole("button", { name: "Unpublish" }).click();
    await expect(page.getByText(/^Unpublished\./)).toBeVisible();
    await expect(page.getByRole("link", { name: "View public page" })).toHaveCount(0);
    await page.getByRole("button", { name: "Restore to public view" }).click();
    await expect(page.getByText("Restored to public view.")).toBeVisible();

    // The list shows it as published.
    await page.goto("/editor?status=published");
    await expect(page.getByRole("link", { name: `${title} (edited)` })).toBeVisible();

    // History: restore revision 1 as a new revision.
    await page.goto(`${editUrl}/history`);
    await expect(page.getByRole("heading", { name: "History", level: 1 })).toBeVisible();
    await expect(page.locator(".revision-list > li")).toHaveCount(5);
    await page.getByRole("link", { name: "Revision 1", exact: true }).click();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Restore revision 1" }).click();
    await expect(page.getByText("Revision 1 restored as revision 6. Visibility did not change.")).toBeVisible();
    await expect(page.locator(".revision-list > li")).toHaveCount(6);

    await page.goto(editUrl);
    await expect(page.getByLabel("Title")).toHaveValue(title);
    await expect(page.locator(".publication-facts")).toContainText("Published");
  });

  test("keyboard users reorder homepage panels with move-up/down buttons", async ({ page, context, baseURL }) => {
    await signInAs(context, baseURL!, "editor");
    await page.goto("/editor/homepage");
    const items = page.getByRole("list", { name: "On the homepage" }).getByRole("listitem");
    await expect(items.first()).toBeVisible();
    const names = await items.locator(".layout-item__name").allInnerTexts();
    const first = names[0]!.replace(/^\d+\.\s*/, "");

    await page.getByRole("button", { name: `Move down ${first}` }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: `${first} moved down to position 2` })).toBeAttached();
    await expect(items.nth(1)).toContainText(first);
    // Focus stays on the moved item, so pressing again keeps working.
    await expect(page.getByRole("button", { name: `Move down ${first}` })).toBeFocused();

    await page.getByRole("button", { name: `Move up ${first}` }).focus();
    await page.keyboard.press("Enter");
    await expect(items.first()).toContainText(first);
    await expect(page.getByRole("button", { name: `Move down ${first}` })).toBeFocused();
  });
});

test.describe("A7 in the UI", () => {
  test("a stale save is refused and the editor's text is kept", async ({ page, context, baseURL }) => {
    await signInAs(context, baseURL!, "editor");
    const title = `Test conflict story ${Date.now()}`;
    const editUrl = (await createDraft(page, title)).replace(/\?.*$/, "");

    const other = await context.newPage();
    await other.goto(editUrl);
    await page.goto(editUrl);

    await other.getByLabel("Title").fill(`${title} (first tab)`);
    await other.getByRole("button", { name: "Save", exact: true }).click();
    await expect(other.getByText("Changes saved.")).toBeVisible();

    await page.getByLabel("Title").fill(`${title} (second tab)`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Someone saved revision 2" })).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue(`${title} (second tab)`);

    await page.getByRole("button", { name: "Save my version as revision 3" }).click();
    await expect(page.getByText("Changes saved.")).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue(`${title} (second tab)`);
    await page.goto(`${editUrl}/history?revision=2`);
    await expect(page.getByRole("heading", { name: `${title} (first tab)` })).toBeVisible();
  });
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`editor pages pass axe (${colorScheme})`, () => {
    test.use({ colorScheme });

    test("list, new with errors and preview, edit, history, and homepage layout", async ({ page, context, baseURL }) => {
      await signInAs(context, baseURL!, "editor");
      const editUrl = (await createDraft(page, `Test axe story ${Date.now()}`)).replace(/\?.*$/, "");

      await page.goto("/editor");
      await expectNoAxeViolations(page);

      await page.goto("/editor/new");
      await page.getByRole("radio", { name: "Report" }).check();
      await page.getByLabel("Title").fill("Test report without a body");
      await page.getByLabel("Summary").fill("Test summary (test data).");
      await page.getByLabel("Category").fill("Technology");
      await page.getByRole("button", { name: "Save draft" }).click();
      await expect(page.getByText("Reports need a body.")).toBeVisible();
      await expect(page.getByLabel("Title")).toHaveValue("Test report without a body");
      await expectNoAxeViolations(page);

      await page.goto(editUrl);
      await page.getByRole("button", { name: "Preview" }).click();
      await expect(page.getByRole("region", { name: "Preview" })).toBeVisible();
      await expectNoAxeViolations(page);

      await page.goto(`${editUrl}/history?revision=1`);
      await expectNoAxeViolations(page);

      await page.goto("/editor/homepage");
      await expectNoAxeViolations(page);
    });
  });
}
