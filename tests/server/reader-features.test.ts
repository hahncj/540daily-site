// Lane 3B: personal dashboard, interest filters, theme, and bookmarks (A9), and reader isolation (A3).
// Loaders and actions run directly with real services over in-memory SQLite.
// Every identity and publication here is test data, not real news.
import { describe, expect, it } from "vitest";
import { loader as rootLoader } from "../../app/root";
import * as dashboardRoute from "../../app/routes/dashboard";
import { loader as homeLoader } from "../../app/routes/home";
import { loader as publicationLoader } from "../../app/routes/publication";
import * as savedRoute from "../../app/routes/saved";
import { SESSION_COOKIE } from "../../server/auth/auth";
import type { Services } from "../../server/app";
import type { MemberActor } from "../../server/core/actors";
import { MAX_BOOKMARKS } from "../../server/core/bookmarks";
import { publicationPath, type Publication } from "../../server/core/publications";
import { bookmarks } from "../../server/db/schema";
import { memberActor, storyInput, testClock } from "../helpers/publishing";
import { run } from "../helpers/routes";
import { BASE_URL, createTestServices, request, sessionCookieFor } from "../helpers/services";

type Fields = Record<string, string | string[]>;

function get(path: string, cookie?: string) {
  return new Request(`${BASE_URL}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
}

function post(path: string, cookie: string | null, fields: Fields, origin = BASE_URL) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of Array.isArray(v) ? v : [v]) body.append(k, one);
  const headers: Record<string, string> = { Origin: origin };
  if (cookie) headers.Cookie = cookie;
  return new Request(`${BASE_URL}${path}`, { method: "POST", headers, body });
}

/** A second signed-in session for the same member: stands in for another device. */
async function anotherSession(services: Services, userId: string) {
  const { serializeSignedCookie } = await import("better-call");
  const ctx = await services.auth.$context;
  const session = await ctx.internalAdapter.createSession(userId);
  if (!session) throw new Error("Session was refused for a test member.");
  const cookie = await serializeSignedCookie(SESSION_COOKIE, session.token, ctx.secret);
  return cookie.split(";")[0]!;
}

type Dashboard = {
  panels: Array<{ category: { id: string; name: string }; items: Array<{ id: string; title: string }> }>;
  available: Array<{ id: string; name: string }>;
  interestTags: Array<{ id: string; name: string }>;
  tagChoices: Array<{ id: string; name: string }>;
  savedIds: string[];
};
type Saved = { saved: { items: Array<{ kind: string; publicationId: string; item?: { title: string } }>; total: number } };

async function dashboard(services: Services, cookie: string) {
  const out = await run(dashboardRoute.loader, services, get("/dashboard", cookie));
  expect(out.status).toBe(200);
  return out.data as Dashboard;
}
const panelNames = (d: Dashboard) => d.panels.map((p) => p.category.name);

function dashboardAction(services: Services, cookie: string, fields: Fields) {
  return run(dashboardRoute.action as never, services, post("/dashboard", cookie, fields));
}

async function movePanel(services: Services, cookie: string, intent: string, categoryId: string) {
  const d = await dashboard(services, cookie);
  return dashboardAction(services, cookie, { intent, categoryId, order: d.panels.map((p) => p.category.id).join(",") });
}

async function saved(services: Services, cookie: string) {
  const out = await run(savedRoute.loader, services, get("/saved", cookie));
  expect(out.status).toBe(200);
  return (out.data as Saved).saved;
}

function bookmark(services: Services, cookie: string, intent: "save" | "remove", publicationId: string) {
  return run(savedRoute.action as never, services, post("/saved", cookie, { intent, publicationId, js: "1" }));
}

async function publish(services: Services, editor: MemberActor, input: Record<string, unknown>) {
  const out = await services.publications.create(editor, input, { publish: true });
  if (!out.ok) throw new Error(out.message);
  return out.value.publication;
}

/** Test data: three categories on the public homepage, each with one published story. */
async function setup() {
  const clock = testClock();
  const services = createTestServices({ now: clock.now });
  const editor = await memberActor(services, "editor@example.test");
  const stories: Record<string, Publication> = {};
  for (const category of ["Technology", "Science", "Sports"]) {
    clock.advance(60_000);
    stories[category] = await publish(services, editor, storyInput({ category, title: `Test data: ${category} story` }));
  }
  let all = await services.categories.listAll();
  const id = (name: string) => all.find((c) => c.name === name)!.id;
  const layout = await services.homepage.setLayout(editor, [id("Technology"), id("Science"), id("Sports")]);
  if (!layout.ok) throw new Error(layout.message);
  const refresh = async () => {
    all = await services.categories.listAll();
  };
  return { services, clock, editor, stories, id, refresh };
}

describe("A9: personal dashboard", () => {
  it("starts from the public layout and later public changes do not overwrite it", async () => {
    const { services, editor, id, clock, refresh } = await setup();
    const reader = await sessionCookieFor(services, "reader@example.test");
    const first = await dashboard(services, reader.cookie);
    expect(panelNames(first)).toEqual(["Technology", "Science", "Sports"]);
    expect(first.panels[0]!.items.map((i) => i.title)).toEqual(["Test data: Technology story"]);

    // The editor changes the public layout and a new category appears.
    clock.advance(60_000);
    await publish(services, editor, storyInput({ category: "Health", title: "Test data: Health story" }));
    await refresh();
    const changed = await services.homepage.setLayout(editor, [id("Sports"), id("Health")]);
    expect(changed.ok).toBe(true);

    const later = await dashboard(services, reader.cookie);
    expect(panelNames(later)).toEqual(["Technology", "Science", "Sports"]);
    // New categories are offered in the selector but never inserted automatically.
    expect(later.available.map((c) => c.name)).toEqual(["Health"]);

    // A member who first visits now starts from the current public layout.
    const newcomer = await sessionCookieFor(services, "newcomer@example.test");
    expect(panelNames(await dashboard(services, newcomer.cookie))).toEqual(["Sports", "Health"]);
  });

  it("panel choice and order persist across sessions and devices without changing the public layout", async () => {
    const { services, id } = await setup();
    const reader = await sessionCookieFor(services, "reader@example.test");

    expect((await movePanel(services, reader.cookie, "down", id("Technology"))).status).toBe(200);
    expect((await movePanel(services, reader.cookie, "remove", id("Sports"))).status).toBe(200);
    expect(panelNames(await dashboard(services, reader.cookie))).toEqual(["Science", "Technology"]);
    expect((await movePanel(services, reader.cookie, "add", id("Sports"))).status).toBe(200);
    expect((await movePanel(services, reader.cookie, "up", id("Sports"))).status).toBe(200);

    const otherDevice = await anotherSession(services, reader.userId);
    expect(panelNames(await dashboard(services, otherDevice))).toEqual(["Science", "Sports", "Technology"]);

    // The public homepage is untouched.
    const home = await run(homeLoader, services, get("/"));
    expect((home.data as Dashboard).panels.map((p) => p.category.name)).toEqual(["Technology", "Science", "Sports"]);

    // Reset copies the current public layout again.
    expect((await movePanel(services, reader.cookie, "reset", "")).status).toBe(200);
    expect(panelNames(await dashboard(services, otherDevice))).toEqual(["Technology", "Science", "Sports"]);
  });

  it("refuses a change based on an out-of-date order and categories that are not public", async () => {
    const { services, id, editor } = await setup();
    const reader = await sessionCookieFor(services, "reader@example.test");
    const d = await dashboard(services, reader.cookie);
    const stale = d.panels.map((p) => p.category.id).join(",");
    await movePanel(services, reader.cookie, "remove", id("Sports"));
    const r = await dashboardAction(services, reader.cookie, { intent: "down", categoryId: id("Technology"), order: stale });
    expect(r.status).toBe(409);
    expect(panelNames(await dashboard(services, reader.cookie))).toEqual(["Technology", "Science"]);

    // A category used only by a draft is not offered and cannot be added.
    const draft = await services.publications.create(editor, storyInput({ category: "Secret Drafts" }));
    expect(draft.ok).toBe(true);
    const after = await dashboard(services, reader.cookie);
    expect(after.available.map((c) => c.name)).not.toContain("Secret Drafts");
    const secretId = (await services.categories.listAll()).find((c) => c.name === "Secret Drafts")!.id;
    const add = await dashboardAction(services, reader.cookie, { intent: "add", categoryId: secretId, order: after.panels.map((p) => p.category.id).join(",") });
    expect(add.status).toBe(422);
  });

  it("interest tags filter panels: any selected tag within the selected categories", async () => {
    const { services, editor, clock } = await setup();
    clock.advance(60_000);
    const cubs = await publish(services, editor, storyInput({ category: "Sports", title: "Test data: Cubs story", tags: ["Cubs"] }));
    clock.advance(60_000);
    const sox = await publish(services, editor, storyInput({ category: "Sports", title: "Test data: Sox story", tags: ["White Sox"] }));
    clock.advance(60_000);
    const chip = await publish(services, editor, storyInput({ category: "Technology", title: "Test data: chip story", tags: ["Chips", "Cubs"] }));
    clock.advance(60_000);
    // Tagged, but in a category that is not on the dashboard: never shown.
    await publish(services, editor, storyInput({ category: "Weather", title: "Test data: weather story", tags: ["Cubs"] }));

    const reader = await sessionCookieFor(services, "reader@example.test");
    const before = await dashboard(services, reader.cookie);
    const tagId = (name: string) => before.tagChoices.find((t) => t.name === name)!.id;
    expect(before.tagChoices.map((t) => t.name)).toEqual(["Chips", "Cubs", "White Sox"]);

    const r = await dashboardAction(services, reader.cookie, { intent: "tags", tag: [tagId("Cubs"), tagId("White Sox")] });
    expect(r.status).toBe(200);
    const filtered = await dashboard(services, reader.cookie);
    const byPanel = Object.fromEntries(filtered.panels.map((p) => [p.category.name, p.items.map((i) => i.id)]));
    expect(byPanel).toEqual({ Technology: [chip.id], Science: [], Sports: [sox.id, cubs.id] });

    // Saved on the account: another device sees the same filter.
    const otherDevice = await anotherSession(services, reader.userId);
    expect((await dashboard(services, otherDevice)).interestTags.map((t) => t.name)).toEqual(["Cubs", "White Sox"]);

    // Clearing every tag shows everything again.
    expect((await dashboardAction(services, reader.cookie, { intent: "tags" })).status).toBe(200);
    const cleared = await dashboard(services, reader.cookie);
    expect(cleared.interestTags).toEqual([]);
    expect(cleared.panels.find((p) => p.category.name === "Sports")!.items).toHaveLength(3);

    // Unknown tags are refused and nothing changes.
    const bad = await dashboardAction(services, reader.cookie, { intent: "tags", tag: ["no-such-tag"] });
    expect(bad.status).toBe(422);
  });
});

describe("A9: theme saved to the account", () => {
  it("persists across devices and is rendered by the root loader", async () => {
    const { services } = await setup();
    const reader = await sessionCookieFor(services, "reader@example.test");
    const rootTheme = async (cookie?: string) => ((await run(rootLoader, services, get("/", cookie))).data as { theme: string }).theme;

    expect(await rootTheme(reader.cookie)).toBe("system");
    expect((await dashboardAction(services, reader.cookie, { intent: "theme", theme: "dark" })).status).toBe(200);
    expect(await rootTheme(await anotherSession(services, reader.userId))).toBe("dark");
    expect(await rootTheme()).toBe("system"); // anonymous visitors use the device setting or localStorage

    expect((await dashboardAction(services, reader.cookie, { intent: "theme", theme: "purple" })).status).toBe(422);
    expect(await rootTheme(reader.cookie)).toBe("dark");
  });
});

describe("A9: bookmarks", () => {
  it("saves, lists the current version, and removes", async () => {
    const { services, editor, stories } = await setup();
    const reader = await sessionCookieFor(services, "reader@example.test");
    const story = stories.Technology!;

    expect((await bookmark(services, reader.cookie, "save", story.id)).data).toEqual({ ok: true, saved: true });
    expect((await bookmark(services, reader.cookie, "save", story.id)).status).toBe(200); // idempotent

    // An edit shows up in the saved list: bookmarks resolve to the current version, not a snapshot.
    const edited = await services.publications.update(editor, story.id, { title: "Test data: edited title", expectedRevision: story.revision });
    expect(edited.ok).toBe(true);
    const list = await saved(services, reader.cookie);
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ kind: "available", publicationId: story.id, item: { title: "Test data: edited title" } });

    // Save buttons know the saved state on lists and the detail page; signed-out visitors get none.
    const home = await run(homeLoader, services, get("/", reader.cookie));
    expect((home.data as Dashboard).savedIds).toEqual([story.id]);
    expect((await run(homeLoader, services, get("/"))).data).toMatchObject({ savedIds: null });
    const path = publicationPath({ id: story.id, title: "Test data: edited title" });
    const detail = await run(publicationLoader, services, get(path, reader.cookie), { id: story.id, slug: path.split("/").pop() });
    expect(detail.data).toMatchObject({ savedIds: [story.id] });

    const otherDevice = await anotherSession(services, reader.userId);
    expect((await saved(services, otherDevice)).total).toBe(1);

    expect((await bookmark(services, otherDevice, "remove", story.id)).data).toEqual({ ok: true, saved: false });
    expect((await saved(services, reader.cookie)).total).toBe(0);
  });

  it("shows a generic unavailable entry for an unpublished item and never leaks its title", async () => {
    const { services, editor, stories } = await setup();
    const reader = await sessionCookieFor(services, "reader@example.test");
    const story = stories.Science!;
    await bookmark(services, reader.cookie, "save", story.id);

    const hidden = await services.publications.unpublish(editor, story.id, story.revision);
    if (!hidden.ok) throw new Error(hidden.message);
    const list = await saved(services, reader.cookie);
    expect(list.items).toEqual([{ kind: "unavailable", publicationId: story.id, savedAt: expect.any(Date) }]);
    expect(JSON.stringify(list)).not.toContain("Science story");
    expect(JSON.stringify(list)).not.toContain("Test summary");

    // It can still be removed, but not saved again while hidden.
    expect((await bookmark(services, reader.cookie, "save", story.id)).status).toBe(404);

    // Restored to public view: the same bookmark shows it again.
    const restored = await services.publications.restoreVisibility(editor, story.id, hidden.value.revision);
    expect(restored.ok).toBe(true);
    expect((await saved(services, reader.cookie)).items[0]).toMatchObject({ kind: "available", item: { title: "Test data: Science story" } });
  });

  it("drafts and unknown IDs cannot be saved, and both look the same", async () => {
    const { services, editor } = await setup();
    const reader = await sessionCookieFor(services, "reader@example.test");
    const draft = await services.publications.create(editor, storyInput({ title: "Test data: secret draft" }));
    if (!draft.ok) throw new Error(draft.message);
    const a = await bookmark(services, reader.cookie, "save", draft.value.publication.id);
    const b = await bookmark(services, reader.cookie, "save", "no-such-id");
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(a.data).toEqual(b.data);
    expect((await saved(services, reader.cookie)).total).toBe(0);
  });

  it("without JavaScript, a save returns to the page it came from (same-site paths only)", async () => {
    const { services, stories } = await setup();
    const reader = await sessionCookieFor(services, "reader@example.test");
    const id = stories.Sports!.id;
    const back = await run(savedRoute.action as never, services, post("/saved", reader.cookie, { intent: "save", publicationId: id, next: "/categories/sports" }));
    expect(back.response?.headers.get("Location")).toBe("/categories/sports");
    const evil = await run(savedRoute.action as never, services, post("/saved", reader.cookie, { intent: "remove", publicationId: id, next: "//evil.example/x" }));
    expect(evil.response?.headers.get("Location")).toBe("/saved");
  });

  it("caps the number of bookmarks per member", async () => {
    const { services, stories } = await setup();
    const reader = await sessionCookieFor(services, "reader@example.test");
    const createdAt = new Date();
    // Test data: fill the quota with fake publication IDs, bypassing foreign keys for this check only.
    services.sqlite.pragma("foreign_keys = OFF");
    await services.db
      .insert(bookmarks)
      .values(Array.from({ length: MAX_BOOKMARKS }, (_, i) => ({ userId: reader.userId, publicationId: `test-fake-${i}`, createdAt })));
    services.sqlite.pragma("foreign_keys = ON");
    expect((await bookmark(services, reader.cookie, "save", stories.Science!.id)).status).toBe(422);
  });
});

describe("A3: reader A cannot see or change reader B's data", () => {
  it("bookmarks, panels, interests, and theme stay private to each member", async () => {
    const { services, stories, id } = await setup();
    const a = await sessionCookieFor(services, "reader-a@example.test");
    const b = await sessionCookieFor(services, "reader-b@example.test");

    // A personalizes everything.
    await bookmark(services, a.cookie, "save", stories.Technology!.id);
    await movePanel(services, a.cookie, "remove", id("Sports"));
    await dashboardAction(services, a.cookie, { intent: "theme", theme: "dark" });

    // B sees none of it.
    expect((await saved(services, b.cookie)).total).toBe(0);
    expect(panelNames(await dashboard(services, b.cookie))).toEqual(["Technology", "Science", "Sports"]);
    expect(((await run(rootLoader, services, get("/", b.cookie))).data as { theme: string }).theme).toBe("system");
    expect((await run(homeLoader, services, get("/", b.cookie))).data).toMatchObject({ savedIds: [] });

    // B's writes, even naming A's bookmarked publication, change only B's own data.
    await bookmark(services, b.cookie, "remove", stories.Technology!.id);
    await movePanel(services, b.cookie, "remove", id("Technology"));
    await dashboardAction(services, b.cookie, { intent: "theme", theme: "light" });
    expect((await saved(services, a.cookie)).items.map((i) => i.publicationId)).toEqual([stories.Technology!.id]);
    expect(panelNames(await dashboard(services, a.cookie))).toEqual(["Technology", "Science"]);
    expect(((await run(rootLoader, services, get("/", a.cookie))).data as { theme: string }).theme).toBe("dark");

    // Extra fields naming another member are ignored: there is no way to address another member's data.
    await run(savedRoute.action as never, services, post("/saved", b.cookie, { intent: "remove", publicationId: stories.Technology!.id, userId: a.userId, js: "1" }));
    expect((await saved(services, a.cookie)).total).toBe(1);
  });

  it("interest filters stay private", async () => {
    const { services, editor } = await setup();
    await publish(services, editor, storyInput({ category: "Sports", tags: ["Cubs"] }));
    const a = await sessionCookieFor(services, "reader-a@example.test");
    const b = await sessionCookieFor(services, "reader-b@example.test");
    const cubs = (await dashboard(services, a.cookie)).tagChoices.find((t) => t.name === "Cubs")!.id;
    await dashboardAction(services, a.cookie, { intent: "tags", tag: [cubs] });
    expect((await dashboard(services, b.cookie)).interestTags).toEqual([]);
    await dashboardAction(services, b.cookie, { intent: "tags" });
    expect((await dashboard(services, a.cookie)).interestTags.map((t) => t.name)).toEqual(["Cubs"]);
  });

  it("signed-out visitors and cross-site posts are refused", async () => {
    const { services, stories } = await setup();
    const reader = await sessionCookieFor(services, "reader@example.test");

    for (const loader of [dashboardRoute.loader, savedRoute.loader]) {
      const out = await run(loader as never, services, get("/dashboard"));
      expect(out.status).toBe(302);
      expect(out.response?.headers.get("Location")).toMatch(/^\/sign-in\?next=/);
    }
    const writes: Array<[unknown, string, Fields]> = [
      [savedRoute.action, "/saved", { intent: "save", publicationId: stories.Sports!.id, js: "1" }],
      [dashboardRoute.action, "/dashboard", { intent: "theme", theme: "dark" }],
    ];
    for (const [fn, path, fields] of writes) {
      expect((await run(fn as never, services, post(path, null, fields))).status).toBe(401);
      expect((await run(fn as never, services, post(path, reader.cookie, fields, "https://evil.example"))).status).toBe(403);
    }
    expect((await saved(services, reader.cookie)).total).toBe(0);
  });

  it("personal pages are not indexed", async () => {
    const { services } = await setup();
    for (const path of ["/dashboard", "/saved"]) {
      expect((await request(services, path)).headers.get("X-Robots-Tag")).toBe("noindex");
    }
  });
});
