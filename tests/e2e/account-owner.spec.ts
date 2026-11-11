// Account page and owner console in a real browser (lane 3A): A6 through the UI (create, use, and
// revoke an API key), A2 owner actions, A3 access, and axe checks in both themes on every layout.
// Members are written straight into the throwaway test database (see helpers/members.ts). Test data only.
// Stories go to their own category, which is not on the homepage, so the public-reading checks are unaffected.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signInAs, type TestRole } from "./helpers/members";

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

/** A second signed-in member in their own browser context. */
async function otherMember(browser: Browser, baseURL: string, role: TestRole) {
  const context = await browser.newContext();
  const member = await signInAs(context, baseURL, role);
  return { ...member, context, page: await context.newPage() };
}

async function createKey(page: Page, label: string) {
  await page.goto("/account");
  await page.getByLabel("Key name").fill(label);
  await page.getByRole("button", { name: "Create API key" }).click();
  await expect(page.getByRole("status").filter({ hasText: `API key "${label}" created.` })).toBeVisible();
  return page.getByLabel("API key (shown once)").inputValue();
}

function storyBody(n: string) {
  return { externalId: `e2e-3a-${n}`, type: "story", title: `Test 3A story ${n}`, summary: "Created by a browser test (test data).", category: "E2E Account Tests" };
}

test.describe("A6: API keys through the account page", () => {
  test("create a key, publish with it, revoke it, and the next call fails", async ({ page, context, baseURL, request }) => {
    await signInAs(context, baseURL!, "editor");
    const response = await page.goto("/account");
    expect(response?.headers()["x-robots-tag"]).toBe("noindex");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");

    const key = await createKey(page, "Browser test agent");
    expect(key).toMatch(/^540daily_/);
    const auth = { Authorization: `Bearer ${key}` };
    const created = await request.post("/api/v1/publications", { headers: auth, data: storyBody(String(Date.now())) });
    expect(created.status()).toBe(201);

    // The secret is not shown again after a reload; only its prefix is listed.
    await page.reload();
    await expect(page.getByLabel("API key (shown once)")).toHaveCount(0);
    const item = page.getByRole("listitem").filter({ hasText: "Browser test agent" });
    await expect(item).toContainText(key.slice(0, 15));
    expect(await page.content()).not.toContain(key);

    await item.getByRole("button", { name: /Revoke/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "revoked" })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Browser test agent" })).toContainText("Revoked");
    expect((await request.post("/api/v1/publications", { headers: auth, data: storyBody(`${Date.now()}-b`) })).status()).toBe(401);
  });

  test("readers see MCP connections but no API keys", async ({ page, context, baseURL }) => {
    await signInAs(context, baseURL!, "reader");
    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "MCP connections" })).toBeVisible();
    await expect(page.getByLabel("MCP server URL")).toHaveValue(`${baseURL}/mcp`);
    await expect(page.getByRole("button", { name: "Create API key" })).toHaveCount(0);
    await expect(page.getByText("API keys are available to editors and the owner.")).toBeVisible();
  });
});

test.describe("A3: access to the owner console", () => {
  test("visitors are sent to sign-in; editors and readers are refused", async ({ page, context, baseURL }) => {
    await page.goto("/owner");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fowner/);
    await signInAs(context, baseURL!, "editor");
    const response = await page.goto("/owner");
    expect(response?.status()).toBe(403);
    expect(response?.headers()["x-robots-tag"]).toBe("noindex");
    await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
  });
});

test.describe("A2 and A6: owner console", () => {
  test("invite, revoke an invitation, change a role, disable, and revoke another member's key", async ({ page, context, baseURL, browser, request }) => {
    await signInAs(context, baseURL!, "owner");
    const reader = await otherMember(browser, baseURL!, "reader");
    const editor = await otherMember(browser, baseURL!, "editor");
    const editorKey = await createKey(editor.page, "Editor agent");

    await page.goto("/owner");
    await expect(page.getByRole("heading", { name: "Owner console" })).toBeVisible();

    // Invite and copy the sign-in link.
    const invitee = `invitee-${Date.now()}@example.test`;
    await page.getByLabel("Email address").fill(invitee.toUpperCase());
    await page.getByRole("button", { name: "Invite reader" }).click();
    await expect(page.getByRole("status").filter({ hasText: `Invitation added for ${invitee}` })).toBeVisible();
    await expect(page.getByLabel("Sign-in link")).toHaveValue(`${baseURL}/sign-in`);
    const invitation = page.getByRole("listitem").filter({ hasText: invitee });
    await expect(invitation).toBeVisible();
    await invitation.getByRole("button", { name: `Revoke invitation for ${invitee}` }).click();
    await expect(page.getByRole("status").filter({ hasText: "Invitation revoked." })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: invitee })).toHaveCount(0);

    // Promote the reader to editor: their account page now offers API keys.
    await page.getByLabel(`Role for ${reader.email}`).selectOption("editor");
    await page.getByRole("button", { name: `Change role for ${reader.email}` }).click();
    await expect(page.getByRole("status").filter({ hasText: `${reader.email} is now editor.` })).toBeVisible();
    await reader.page.goto("/account");
    await expect(reader.page.getByRole("button", { name: "Create API key" })).toBeVisible();

    // Disable them: their next request is signed out.
    await page.getByRole("button", { name: `Disable ${reader.email}` }).click();
    await expect(page.getByRole("status").filter({ hasText: `${reader.email} is disabled.` })).toBeVisible();
    await reader.page.goto("/account");
    await expect(reader.page).toHaveURL(/\/sign-in/);
    await page.getByRole("button", { name: `Enable ${reader.email}` }).click();
    await expect(page.getByRole("status").filter({ hasText: `${reader.email} is active again.` })).toBeVisible();

    // Revoke another member's key from the console.
    const auth = { Authorization: `Bearer ${editorKey}` };
    expect((await request.get("/api/v1/categories", { headers: auth })).status()).toBe(200);
    await page.getByRole("button", { name: `Revoke key Editor agent for ${editor.email}` }).click();
    await expect(page.getByRole("status").filter({ hasText: "API key revoked." })).toBeVisible();
    expect((await request.get("/api/v1/categories", { headers: auth })).status()).toBe(401);

    await reader.context.close();
    await editor.context.close();
  });
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`account and owner pages pass axe (${colorScheme})`, () => {
    test.use({ colorScheme });

    test("account with a new key, and the owner console", async ({ page, context, baseURL }) => {
      await signInAs(context, baseURL!, "owner");
      await createKey(page, "Axe key");
      await expectNoAxeViolations(page);

      await page.goto("/owner");
      await page.getByLabel("Email address").fill("not-an-email@");
      // Bypass the browser's own email check so the server's error is shown.
      await page.locator("form[aria-label='Invite a reader']").evaluate((f) => f.setAttribute("novalidate", ""));
      await page.getByRole("button", { name: "Invite reader" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });
}

test.describe("account menu", () => {
  const expected: Record<TestRole, string[]> = {
    reader: ["Saved", "Account", "Settings", "Sign out"],
    editor: ["Saved", "Editor", "Homepage layout", "Account", "Settings", "Sign out"],
    owner: ["Saved", "Editor", "Homepage layout", "Owner console", "Account", "Settings", "Sign out"],
  };
  for (const role of ["reader", "editor", "owner"] as const) {
    test(`${role}: role pages live in the menu, not the main nav`, async ({ page, context, baseURL }) => {
      const member = await signInAs(context, baseURL!, role);
      await page.goto("/");
      const header = page.getByRole("banner");
      await expect(header.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText(["Home", "Categories", "Search"]);

      const button = header.getByRole("button", { name: `Account menu: ${member.name}` });
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "true");
      const panel = page.locator(".account-menu__panel");
      await expect(panel.getByText(member.email)).toBeVisible();
      await expect(panel.getByRole("link").or(panel.getByRole("button"))).toHaveText(expected[role]);
      await expectNoAxeViolations(page);

      // Escape closes it and returns focus to the button.
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(button).toBeFocused();

      // Following a link closes it.
      await button.click();
      await panel.getByRole("link", { name: "Settings" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
      await expect(panel).toBeHidden();
    });
  }
});
