// Daily story prompt in the owner console, in a real browser: save, read back over the HTTP API with
// the owner's key, restore an earlier revision, keep a draft on a conflicting save, and refuse
// editors' agents. Every project shares one database, so each run uses unique text. Test data only.
import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./helpers/members";

async function createKey(page: Page, label: string) {
  await page.goto("/account");
  await page.getByLabel("Key name").fill(label);
  await page.getByRole("button", { name: "Create API key" }).click();
  await expect(page.getByRole("status").filter({ hasText: `API key "${label}" created.` })).toBeVisible();
  return page.getByLabel("API key (shown once)").inputValue();
}

async function savePrompt(page: Page, text: string, note = "") {
  const section = page.locator("#daily-prompt");
  const next = Number(await section.locator('input[name="expectedRevision"]').first().inputValue()) + 1;
  await section.getByLabel("Prompt", { exact: true }).fill(text);
  await section.getByLabel("What changed (optional)").fill(note);
  await section.getByRole("button", { name: "Save prompt" }).click();
  await expect(section.getByRole("status").filter({ hasText: `Saved as revision ${next}.` })).toBeVisible();
  return next;
}

test.describe("daily story prompt", () => {
  test("save, read with the owner's key, and restore", async ({ page, context, baseURL, request }) => {
    await signInAs(context, baseURL!, "owner");
    const key = await createKey(page, "Prompt test key");
    const auth = { Authorization: `Bearer ${key}` };
    const run = String(Date.now());
    const first = `E2E test prompt A ${run} (test data).\nSecond line.`;
    const second = `E2E test prompt B ${run} (test data).`;

    await page.goto("/owner#daily-prompt");
    const r1 = await savePrompt(page, first, "First test save");
    const read1 = await request.get("/api/v1/prompts/daily-story", { headers: auth });
    expect(read1.status()).toBe(200);
    expect((await read1.json()).prompt).toMatchObject({ revision: r1, text: first });

    const r2 = await savePrompt(page, second);
    expect(r2).toBe(r1 + 1);
    const section = page.locator("#daily-prompt");
    await expect(section.getByLabel("Prompt", { exact: true })).toHaveValue(second);
    const item = section.getByRole("listitem").filter({ hasText: `Revision ${r1}` });
    await expect(item).toContainText("First test save");
    await item.getByText("View text").click();
    await expect(item.locator("pre")).toHaveText(first);

    await item.getByRole("button", { name: `Restore revision ${r1}` }).click();
    await expect(section.getByRole("status").filter({ hasText: `Restored as revision ${r2 + 1}.` })).toBeVisible();
    await expect(section.getByLabel("Prompt", { exact: true })).toHaveValue(first);
    expect((await (await request.get("/api/v1/prompts/daily-story", { headers: auth })).json()).prompt).toMatchObject({ revision: r2 + 1, text: first });
  });

  test("a save over a newer revision is refused and keeps the draft", async ({ page, context, baseURL }) => {
    await signInAs(context, baseURL!, "owner");
    const run = String(Date.now());
    await page.goto("/owner#daily-prompt");
    const other = await context.newPage();
    await other.goto("/owner#daily-prompt");
    const saved = await savePrompt(other, `E2E test prompt from another tab ${run} (test data).`);

    const draft = `E2E test prompt draft ${run} (test data).`;
    const section = page.locator("#daily-prompt");
    await section.getByLabel("Prompt", { exact: true }).fill(draft);
    await section.getByRole("button", { name: "Save prompt" }).click();
    await expect(section.getByRole("alert")).toContainText(`Revision ${saved} was saved while you were editing.`);
    await expect(section.getByLabel("Prompt", { exact: true })).toHaveValue(draft);
    await expect(section.getByRole("listitem").filter({ hasText: `Revision ${saved} (current)` })).toBeVisible();

    // Saving again now targets the newest revision and succeeds.
    await section.getByRole("button", { name: "Save prompt" }).click();
    await expect(section.getByRole("status").filter({ hasText: `Saved as revision ${saved + 1}.` })).toBeVisible();
  });

  test("editors' agents cannot read the prompt", async ({ page, context, baseURL, request }) => {
    await signInAs(context, baseURL!, "editor");
    const key = await createKey(page, "Editor prompt test key");
    const response = await request.get("/api/v1/prompts/daily-story", { headers: { Authorization: `Bearer ${key}` } });
    expect(response.status()).toBe(403);
  });
});
