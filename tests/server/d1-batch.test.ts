// Runs the multi-step write paths on real D1 (Miniflare, in memory) instead of better-sqlite3.
// D1 executes atomic() as a batch, a different code path from the SQLite transaction the other tests use.
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { migrate } from "drizzle-orm/d1/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { createServices, type Services } from "../../server/app";
import { inList } from "../../server/adapters/in-list";
import { fetchClientMetadataViaFetch } from "../../server/auth/cimd-fetch";
import { loadConfig } from "../../server/config";
import * as schema from "../../server/db/schema";
import { MemoryMediaStore } from "../helpers/memory-media";
import { api, callTool, connectAgent, memberWithKey } from "../helpers/agents";
import { memberActor, PNG_BYTES, reportInput, storyInput, SVG_BYTES, testClock, uploadImage } from "../helpers/publishing";
import { BASE_URL, createMember, sessionCookieFor, signInWithGoogle } from "../helpers/services";

let services: Services;
let db: DrizzleD1Database<typeof schema>;
let config: ReturnType<typeof loadConfig>;
let media: MemoryMediaStore;
let dispose: () => Promise<void>;

/** Services on the same D1 database, optionally with a test clock. Google's signature check is replaced. */
function servicesOnD1(now?: () => Date, configOverride = config) {
  return createServices({ config: configOverride, db, media, now, fetchClientMetadata: fetchClientMetadataViaFetch, googleTestOverrides: { verifyIdToken: async () => true } });
}

beforeAll(async () => {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: "hosting/cloudflare/wrangler.jsonc", persist: false });
  dispose = proxy.dispose;
  db = drizzle(proxy.env.DB, { schema });
  await migrate(db, { migrationsFolder: "db/migrations" });
  config = loadConfig(
    {
      PUBLIC_BASE_URL: BASE_URL,
      OWNER_EMAIL: "owner@example.test",
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
      GOOGLE_CLIENT_ID: "test-google-client-id",
      GOOGLE_CLIENT_SECRET: "test-google-client-secret",
    },
    "node",
  );
  media = new MemoryMediaStore();
  services = servicesOnD1();
}, 60_000);

afterAll(async () => {
  await dispose?.();
});

describe("multi-step writes on D1", () => {
  it("first dashboard visit copies the homepage layout", async () => {
    const userId = await createMember(services, "reader@example.test", "reader");
    const { panels } = await services.preferences.dashboard(userId);
    expect(panels.length).toBeGreaterThan(0);
    const again = await services.preferences.dashboard(userId);
    expect(again.panels).toEqual(panels);
  });

  it("dashboard panel and interest changes save", async () => {
    const userId = await createMember(services, "reader2@example.test", "reader");
    const { panels } = await services.preferences.dashboard(userId);
    const reordered = [...panels].reverse().map((p) => p.id);
    const saved = await services.preferences.setPanels(userId, reordered);
    expect(saved.ok && saved.value.map((p) => p.id)).toEqual(reordered);
    expect((await services.preferences.setInterestTags(userId, [])).ok).toBe(true);
  });

  it("stories can be created, updated, unpublished, restored, and rolled back", async () => {
    const editor = await memberActor(services, "editor@example.test", "editor");
    const created = await services.publications.create(editor, storyInput({ tags: ["Test tag"] }), { publish: true });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.publication.id;

    // D1 counts rows changed by the search-index triggers, so a real update must not look stale.
    const updated = await services.publications.update(editor, id, { expectedRevision: 1, title: "Updated test story", tags: ["Other tag"] });
    expect(updated).toMatchObject({ ok: true, value: { revision: 2 } });

    const stale = await services.publications.update(editor, id, { expectedRevision: 1, title: "Stale edit" });
    expect(stale).toMatchObject({ ok: false, status: "conflict" });

    expect(await services.publications.unpublish(editor, id, 2)).toMatchObject({ ok: true, value: { revision: 3, status: "unpublished" } });
    expect(await services.publications.getPublic(id)).toBeNull();
    expect(await services.publications.restoreVisibility(editor, id, 3)).toMatchObject({ ok: true, value: { revision: 4, status: "published" } });

    expect(await services.publications.restoreRevision(editor, id, 1, 4)).toMatchObject({ ok: true, value: { revision: 5 } });
    const history = await services.publications.history(editor, id);
    expect(history.ok && history.value.length).toBe(5);

    const found = await services.search.publicSearch({ q: "Test story" });
    expect(JSON.stringify(found)).toContain(id);
  });
});

describe("agent publishing on D1", () => {
  it("create replays across MCP and HTTP, concurrent creates make one item, and a changed payload is a conflict", async () => {
    const { key } = await memberWithKey(services, "d1-agent@example.test", "editor");
    const payload = storyInput({ externalId: "d1-replay-1", category: "D1 Agent Tests", tags: ["d1 tag"] });
    const results = await Promise.all([
      callTool(services, key, "create_publication", payload).then((r) => r.body),
      api(services, key, "POST", "/api/v1/publications", payload).then((r) => r.body),
      callTool(services, key, "create_publication", payload).then((r) => r.body),
      api(services, key, "POST", "/api/v1/publications", payload).then((r) => r.body),
    ]);
    const ids = new Set(results.map((r) => (r.publication as { id: string }).id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.status === "created")).toHaveLength(1);
    expect(results.filter((r) => r.status === "replayed")).toHaveLength(3);

    const changed = await api(services, key, "POST", "/api/v1/publications", { ...payload, title: "Changed title" });
    expect(changed.status).toBe(409);
    expect(changed.body.status).toBe("conflict");

    // The agent updates its own item; the revision check is a conditional write on D1.
    const id = [...ids][0]!;
    const updated = await api(services, key, "PATCH", `/api/v1/publications/${id}`, { expectedRevision: 1, title: "Agent update" });
    expect(updated.status).toBe(200);
    expect(updated.body.publication).toMatchObject({ revision: 2, title: "Agent update" });
    const stale = await callTool(services, key, "update_publication", { id, expectedRevision: 1, title: "Stale" });
    expect(stale.body.status).toBe("conflict");
  });

  it("agent failures are logged for the owner, and the log prunes in the same batch", async () => {
    const owner = await memberActor(services, "d1-failures-owner@example.test", "owner");
    const { key } = await memberWithKey(services, "d1-failing-agent@example.test", "editor");
    const bad = await api(services, key, "POST", "/api/v1/publications", { ...storyInput({ externalId: "d1-bad-1" }), title: "" });
    expect(bad.status).toBe(422);
    const failures = await services.publishingFailures.listRecent({ role: owner.role, status: "active" });
    expect(failures?.some((f) => f.externalId === "d1-bad-1")).toBe(true);
  });

  it("audit events are recorded for publishing and access changes", async () => {
    const editor = await memberActor(services, "d1-audit@example.test", "editor");
    const created = await services.publications.create(editor, storyInput({ category: "D1 Agent Tests" }), { publish: true });
    expect(created.ok).toBe(true);
    const events = await db.select().from(schema.auditEvents);
    expect(events.some((e) => e.actorUserId === editor.userId)).toBe(true);
  });
});

describe("layout and limits on D1", () => {
  it("editors replace the homepage layout in one batch", async () => {
    const editor = await memberActor(services, "d1-layout@example.test", "editor");
    const before = await services.homepage.layout();
    const reversed = [...before].reverse().map((c) => c.id);
    expect(await services.homepage.setLayout(editor, reversed)).toMatchObject({ ok: true });
    expect((await services.homepage.layout()).map((c) => c.id)).toEqual(reversed);
    expect((await services.homepage.setLayout(editor, before.map((c) => c.id))).ok).toBe(true);
  });

  it("agent write limits return 429 once the shared counter is full", async () => {
    const frozen = testClock(new Date().toISOString());
    const limited = servicesOnD1(frozen.now, { ...config, rateLimits: { ...config.rateLimits, writes: 2 } });
    const { key } = await memberWithKey(limited, "d1-rate@example.test", "editor");
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await api(limited, key, "POST", "/api/v1/publications", storyInput({ category: "D1 Agent Tests" }))).status);
    expect(statuses).toEqual([201, 201, 429]);
  });
});

describe("attachments on D1", () => {
  it("upload tickets are single use, and attachment visibility follows the publication", async () => {
    const editor = await memberActor(services, "d1-uploader@example.test", "editor");
    const ticket = await services.attachments.prepareUpload(editor, { mimeType: "image/png", size: PNG_BYTES.byteLength, altText: "Test chart" });
    expect(ticket.ok).toBe(true);
    if (!ticket.ok) return;
    expect(await services.attachments.completeUpload(ticket.value.token, PNG_BYTES)).toMatchObject({ ok: true, value: { status: "ready" } });
    expect(await services.attachments.completeUpload(ticket.value.token, PNG_BYTES)).toMatchObject({ ok: false, status: "not_found" });

    const svg = await services.attachments.prepareUpload(editor, { mimeType: "image/png", size: SVG_BYTES.byteLength, altText: "x" });
    expect(svg.ok && (await services.attachments.completeUpload(svg.value.token, SVG_BYTES)).ok).toBe(false);

    const id = ticket.value.attachmentId;
    expect(await services.attachments.open(null, id)).toBeNull();
    const created = await services.publications.create(editor, reportInput({ bodyMarkdown: `![Test chart](attachment:${id})`, category: "D1 Agent Tests" }), {
      publish: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect((await services.attachments.open(null, id))?.visibility).toBe("public");
    // A new revision without the image keeps the old reference for history, but the image is no longer public.
    const pubId = created.value.publication.id;
    expect((await services.publications.update(editor, pubId, { expectedRevision: 1, bodyMarkdown: "No image now." })).ok).toBe(true);
    expect(await services.attachments.open(null, id)).toBeNull();
    expect((await services.attachments.open({ userId: editor.userId, role: "editor", status: "active" }, id))?.visibility).toBe("private");
  });

  it("owner cleanup deletes more than 100 old unreferenced uploads in one run", async () => {
    const clock = testClock(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString());
    const past = servicesOnD1(clock.now);
    const editor = await memberActor(services, "d1-cleanup@example.test", "editor");
    const ids: string[] = [];
    for (let i = 0; i < 120; i++) ids.push(await uploadImage(past, editor));
    const owner = await memberActor(services, "d1-cleanup-owner@example.test", "owner");
    const result = await services.attachments.cleanupUnreferenced({ userId: owner.userId, role: "owner", status: "active" });
    expect(result.ok && result.value.deleted).toBeGreaterThanOrEqual(120);
    const left = await db.select({ id: schema.attachments.id }).from(schema.attachments).where(inList(schema.attachments.id, ids));
    expect(left).toHaveLength(0);
  }, 60_000);
});

describe("credentials and members on D1", () => {
  it("API keys are created, used, and revoked", async () => {
    const editor = { userId: await createMember(services, "d1-keys@example.test", "editor"), role: "editor" as const, status: "active" as const };
    const created = await services.apiKeys.create(editor, "D1 test key");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect((await api(services, created.value.key, "GET", "/api/v1/categories")).status).toBe(200);
    expect((await services.apiKeys.revoke(editor, created.value.info.id)).ok).toBe(true);
    expect((await api(services, created.value.key, "GET", "/api/v1/categories")).status).toBe(401);
  });

  it("an MCP connection works until it is disconnected", async () => {
    const member = await sessionCookieFor(services, "d1-mcp@example.test", "editor");
    const { clientId, accessToken } = await connectAgent(services, member, { clientName: "D1 test client" });
    expect((await api(services, accessToken, "GET", "/api/v1/categories")).status).toBe(200);
    const viewer = { userId: member.userId, role: "editor" as const, status: "active" as const };
    expect((await services.agents.listOwnConnections(viewer)).map((c) => c.clientId)).toContain(clientId);
    expect((await services.agents.disconnect(viewer, { userId: member.userId, clientId })).ok).toBe(true);
    expect((await api(services, accessToken, "GET", "/api/v1/categories")).status).toBe(401);
    expect(await services.agents.listOwnConnections(viewer)).toEqual([]);
  });

  it("invitations, sign-in, role changes, disabling, and the sole-owner guard", async () => {
    const owner = { userId: await createMember(services, "d1-owner@example.test", "owner"), role: "owner" as const, status: "active" as const };
    const invited = await services.members.invite(owner, "d1-invitee@example.test");
    expect(invited.ok).toBe(true);
    expect((await signInWithGoogle(services, { email: "d1-uninvited@example.test" })).status).toBe(403);
    expect((await signInWithGoogle(services, { email: "D1-Invitee@example.test" })).status).toBe(200);
    const member = (await services.members.listMembers(owner))?.find((m) => m.email.toLowerCase() === "d1-invitee@example.test");
    expect(member).toMatchObject({ role: "reader", status: "active" });
    if (!member) return;
    expect((await services.members.listInvitations(owner))?.some((i) => i.email === "d1-invitee@example.test")).toBe(false);

    const revokable = await services.members.invite(owner, "d1-revoked@example.test");
    expect(revokable.ok && (await services.members.revokeInvitation(owner, revokable.value.invitationId)).ok).toBe(true);
    expect((await signInWithGoogle(services, { email: "d1-revoked@example.test" })).status).toBe(403);

    expect(await services.members.changeRole(owner, member.userId, "editor")).toMatchObject({ ok: true, value: { role: "editor" } });
    const ctx = await services.auth.$context;
    await ctx.internalAdapter.createSession(member.userId);
    expect(await services.members.setStatus(owner, member.userId, "disabled")).toMatchObject({ ok: true, value: { status: "disabled" } });
    expect(await db.select().from(schema.session).where(eq(schema.session.userId, member.userId))).toEqual([]);
    expect(await services.members.setStatus(owner, member.userId, "active")).toMatchObject({ ok: true });

    // Other test owners exist in this shared database, so disable them first to reach the sole-owner case.
    const owners = (await services.members.listMembers(owner))!.filter((m) => m.role === "owner" && m.status === "active" && m.userId !== owner.userId);
    for (const o of owners) await db.update(schema.memberships).set({ status: "disabled" }).where(eq(schema.memberships.userId, o.userId));
    try {
      expect(await services.members.changeRole(owner, owner.userId, "editor")).toMatchObject({ ok: false, status: "conflict" });
      expect((await services.members.listMembers(owner))!.find((m) => m.userId === owner.userId)).toMatchObject({ role: "owner", status: "active" });
    } finally {
      for (const o of owners) await db.update(schema.memberships).set({ status: "active" }).where(eq(schema.memberships.userId, o.userId));
    }
  });
});

describe("reader data on D1", () => {
  it("bookmarks and theme save and read back", async () => {
    const editor = await memberActor(services, "d1-bookmark-editor@example.test", "editor");
    const reader = await createMember(services, "d1-bookmarks@example.test", "reader");
    const created = await services.publications.create(editor, storyInput({ category: "D1 Agent Tests" }), { publish: true });
    if (!created.ok) throw new Error(created.message);
    const id = created.value.publication.id;
    expect((await services.bookmarks.save(reader, id)).ok).toBe(true);
    expect((await services.bookmarks.save(reader, id)).ok).toBe(true);
    const list = await services.bookmarks.list(reader);
    expect(list.items).toEqual([expect.objectContaining({ kind: "available" })]);
    expect((await services.bookmarks.remove(reader, id)).ok).toBe(true);
    expect((await services.bookmarks.list(reader)).total).toBe(0);

    expect((await services.preferences.setTheme(reader, "dark")).ok).toBe(true);
    expect(await services.preferences.theme(reader)).toBe("dark");
    expect((await services.preferences.setTheme(reader, "light")).ok).toBe(true);
    expect(await services.preferences.theme(reader)).toBe("light");
  });

  it("homepages and dashboards with many panels, interests, and items stay within D1's bound-parameter limit", async () => {
    const editor = await memberActor(services, "d1-many@example.test", "editor");
    const categoryIds: string[] = [];
    const tagNames = Array.from({ length: 20 }, (_, i) => `D1 many tag ${i}`);
    const itemIds: string[] = [];
    for (let c = 0; c < 25; c++) {
      for (let i = 0; i < 5; i++) {
        const out = await services.publications.create(editor, storyInput({ category: `D1 Many ${c}`, tags: tagNames.slice(0, 20) }), { publish: true });
        if (!out.ok) throw new Error(out.message);
        itemIds.push(out.value.publication.id);
        if (i === 0) categoryIds.push(out.value.publication.category.id);
      }
    }
    // 25 panels × 5 items = 125 IDs in one page.
    const latest = await services.publications.latestPerCategory(categoryIds);
    expect([...latest.values()].flat()).toHaveLength(125);
    const reader = await createMember(services, "d1-many-reader@example.test", "reader");
    expect((await services.bookmarks.savedAmong(reader, itemIds)).size).toBe(0);

    // 50 panels and 50 interest tags in one dashboard query.
    for (let c = 25; c < 50; c++) {
      const out = await services.publications.create(editor, storyInput({ category: `D1 Many ${c}` }), { publish: true });
      if (!out.ok) throw new Error(out.message);
      categoryIds.push(out.value.publication.category.id);
    }
    const moreTags = Array.from({ length: 30 }, (_, i) => `D1 extra tag ${i}`);
    for (let i = 0; i < moreTags.length; i += 20) {
      const out = await services.publications.create(editor, storyInput({ category: "D1 Many 0", tags: moreTags.slice(i, i + 20) }), { publish: true });
      if (!out.ok) throw new Error(out.message);
    }
    const allTags = (await services.tags.listWithPublished()).filter((t) => t.name.startsWith("D1 ")).slice(0, 50);
    expect(allTags).toHaveLength(50);
    expect((await services.preferences.setPanels(reader, categoryIds)).ok).toBe(true);
    expect((await services.preferences.setInterestTags(reader, allTags.map((t) => t.id))).ok).toBe(true);
    const filtered = await services.publications.latestPerCategory(categoryIds, 5, allTags.map((t) => t.id));
    expect([...filtered.values()].flat().length).toBeGreaterThan(0);
  }, 120_000);
});
