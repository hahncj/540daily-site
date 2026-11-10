// Publishing core against real migrations on in-memory SQLite. All content is test data.
import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createPublicationsRepository } from "../../server/adapters/publications-repo";
import { createPublications } from "../../server/core/publications";
import { publicationRevisions, publications, publishingFailures, submissionReceipts } from "../../server/db/schema";
import { agentFor, memberActor, reportInput, storyInput, testClock } from "../helpers/publishing";
import { createTestServices } from "../helpers/services";

/** Hold the first `n` calls of `repo[method]` until all `n` have read, to force a write race. */
function holdFirstCalls<R extends object, K extends keyof R>(repo: R, method: K, n = 2) {
  const real = repo[method] as unknown as (...args: unknown[]) => Promise<unknown>;
  let waiting: Array<() => void> = [];
  const state = { calls: 0 };
  (repo as Record<K, unknown>)[method] = async (...args: unknown[]) => {
    const out = await real.apply(repo, args);
    if (++state.calls <= n) {
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
        if (waiting.length === n) {
          waiting.forEach((r) => r());
          waiting = [];
        }
      });
    }
    return out;
  };
  return state;
}

function servicesWithRepo(services: ReturnType<typeof createTestServices>, repo: ReturnType<typeof createPublicationsRepository>) {
  return createPublications({
    repo,
    attachments: services.attachments,
    markdown: services.markdown,
    audit: services.audit,
    failures: services.publishingFailures,
    now: services.now,
    newId: services.newId,
  });
}

async function countRows(services: ReturnType<typeof createTestServices>, table: typeof publications | typeof submissionReceipts) {
  const [row] = await services.db.select({ n: count() }).from(table);
  return row!.n;
}

describe("validation schema (shared by editors, MCP, and HTTP)", () => {
  it("rejects missing and oversized fields with structured errors", async () => {
    const services = createTestServices();
    const agent = agentFor(await memberActor(services, "editor@example.test"));
    const out = await services.publications.create(agent, { type: "story", title: "x".repeat(201), summary: "", category: "" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.status).toBe("invalid");
    expect(Object.keys(out.errors!)).toEqual(expect.arrayContaining(["externalId", "title", "summary", "category"]));
  });

  it("requires a body for reports, and rejects unknown fields and non-http sources", async () => {
    const services = createTestServices();
    const agent = agentFor(await memberActor(services, "editor@example.test"));
    const noBody = await services.publications.create(agent, storyInput({ type: "report" }));
    expect(!noBody.ok && noBody.errors?.bodyMarkdown).toBeTruthy();
    const unknown = await services.publications.create(agent, storyInput({ status: "draft" }));
    expect(!unknown.ok && unknown.status).toBe("invalid");
    const badSource = await services.publications.create(agent, storyInput({ sources: [{ url: "javascript:alert(1)" }] }));
    expect(!badSource.ok && Object.keys(badSource.errors!)[0]).toMatch(/^sources/);
  });

  it("normalizes category and tag names and creates categories automatically (A4, core)", async () => {
    const services = createTestServices();
    const agent = agentFor(await memberActor(services, "editor@example.test"));
    const a = await services.publications.create(agent, storyInput({ category: "  Climate   Science ", tags: ["AI", " ai ", "Café"] }));
    const b = await services.publications.create(agent, storyInput({ category: "climate science" }));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.publication.category).toMatchObject({ name: "Climate Science", slug: "climate-science" });
    expect(b.value.publication.category.id).toBe(a.value.publication.category.id);
    expect(a.value.publication.tags.map((t) => t.slug).sort()).toEqual(["ai", "cafe"]);
    // New categories are persisted but stay off the public homepage until an editor selects them.
    const layout = await services.homepage.layout();
    expect(layout.map((c) => c.name)).toEqual(["Technology", "Business", "Finance", "Sports", "Entertainment"]);
    expect((await services.categories.listWithPublished()).map((c) => c.name)).toContain("Climate Science");
  });

  it("gives colliding category names distinct, stable slugs", async () => {
    const services = createTestServices();
    const agent = agentFor(await memberActor(services, "editor@example.test"));
    const a = await services.publications.create(agent, storyInput({ category: "C++" }));
    const b = await services.publications.create(agent, storyInput({ category: "C" }));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.publication.category.slug).toBe("c");
    expect(b.value.publication.category.slug).toBe("c-2");
  });
});

describe("A5: retry protection", () => {
  it("replays an identical create and writes nothing new", async () => {
    const services = createTestServices();
    const agent = agentFor(await memberActor(services, "editor@example.test"));
    const input = storyInput();
    const first = await services.publications.create(agent, input);
    const again = await services.publications.create(agent, { ...input });
    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(first.value.replayed).toBe(false);
    expect(again.value.replayed).toBe(true);
    expect(again.value.publication.id).toBe(first.value.publication.id);
    expect(again.value.publication.revision).toBe(1);
    expect(await countRows(services, publications)).toBe(1);
  });

  it("replays across the member's other credentials (an MCP client and an API key)", async () => {
    const services = createTestServices();
    const editor = await memberActor(services, "editor@example.test");
    const input = storyInput();
    const viaKey = await services.publications.create(agentFor(editor, { credentialKind: "api_key", credentialId: "key-1" }), input);
    const viaMcp = await services.publications.create(agentFor(editor, { credentialKind: "oauth", credentialId: "client-1", label: "Test MCP client" }), input);
    expect(viaKey.ok && viaMcp.ok && viaMcp.value.replayed && viaMcp.value.publication.id === viaKey.value.publication.id).toBe(true);
    expect(await countRows(services, publications)).toBe(1);
  });

  it("returns the current revision on replay after an update", async () => {
    const services = createTestServices();
    const agent = agentFor(await memberActor(services, "editor@example.test"));
    const input = storyInput();
    const first = await services.publications.create(agent, input);
    if (!first.ok) throw new Error(first.message);
    await services.publications.update(agent, first.value.publication.id, { expectedRevision: 1, title: "Changed (test)" });
    const replay = await services.publications.create(agent, input);
    expect(replay.ok && replay.value.publication.revision).toBe(2);
  });

  it("produces one publication from concurrent identical creates", async () => {
    const services = createTestServices();
    const editor = await memberActor(services, "editor@example.test");
    const input = storyInput({ category: "Brand New Category", tags: ["fresh-tag"] });
    const results = await Promise.all([
      services.publications.create(agentFor(editor, { credentialKind: "oauth", credentialId: "client-1" }), input),
      services.publications.create(agentFor(editor, { credentialKind: "api_key", credentialId: "key-1" }), input),
      services.publications.create(agentFor(editor, { credentialKind: "api_key", credentialId: "key-2" }), input),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    const ids = new Set(results.map((r) => (r.ok ? r.value.publication.id : null)));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.ok && !r.value.replayed)).toHaveLength(1);
    expect(await countRows(services, publications)).toBe(1);
    expect(await countRows(services, submissionReceipts)).toBe(1);
  });

  it("lets the receipt's unique index decide when both creates miss the receipt lookup", async () => {
    const services = createTestServices();
    const editor = await memberActor(services, "editor@example.test");
    // Force the race: both creates read "no receipt" before either writes.
    const repo = createPublicationsRepository(services.db);
    const probe = holdFirstCalls(repo, "findReceipt");
    const racing = servicesWithRepo(services, repo);
    const input = storyInput();
    const changed = { ...input, title: "Changed while racing (test)" };
    const [a, b] = await Promise.all([
      racing.create(agentFor(editor, { credentialKind: "oauth", credentialId: "client-1" }), input),
      racing.create(agentFor(editor, { credentialKind: "api_key", credentialId: "key-1" }), input),
    ]);
    expect(probe.calls).toBeGreaterThanOrEqual(3); // the loser re-read the receipt after its batch failed
    expect(a.ok && b.ok && a.value.publication.id === b.value.publication.id).toBe(true);
    expect([a.ok && a.value.replayed, b.ok && b.value.replayed].sort()).toEqual([false, true]);
    expect(await countRows(services, publications)).toBe(1);
    expect(await countRows(services, submissionReceipts)).toBe(1);

    probe.calls = 0;
    const [c, d] = await Promise.all([racing.create(agentFor(editor), { ...input, externalId: "race-2" }), racing.create(agentFor(editor), { ...changed, externalId: "race-2" })]);
    expect([c.ok ? "ok" : c.status, d.ok ? "ok" : d.status].sort()).toEqual(["conflict", "ok"]);
    expect(await countRows(services, publications)).toBe(2);
  });

  it("returns a conflict for a changed payload under the same externalId", async () => {
    const services = createTestServices();
    const agent = agentFor(await memberActor(services, "editor@example.test"));
    const input = storyInput();
    await services.publications.create(agent, input);
    const changed = await services.publications.create(agent, { ...input, title: "Different title (test)" });
    expect(!changed.ok && changed.status).toBe("conflict");
    const concurrent = await Promise.all([
      services.publications.create(agent, { ...input, externalId: "race-1", title: "A (test)" }),
      services.publications.create(agent, { ...input, externalId: "race-1", title: "B (test)" }),
    ]);
    expect(concurrent.map((r) => (r.ok ? "ok" : r.status)).sort()).toEqual(["conflict", "ok"]);
  });

  it("scopes externalId per member", async () => {
    const services = createTestServices();
    const a = agentFor(await memberActor(services, "a@example.test"));
    const b = agentFor(await memberActor(services, "b@example.test"));
    const input = storyInput();
    const ra = await services.publications.create(a, input);
    const rb = await services.publications.create(b, input);
    expect(ra.ok && rb.ok && ra.value.publication.id !== rb.value.publication.id).toBe(true);
  });

  it("leaves no receipt or publication when a create fails", async () => {
    const services = createTestServices();
    const agent = agentFor(await memberActor(services, "editor@example.test"));
    const input = storyInput({ attachmentIds: ["does-not-exist"] });
    const out = await services.publications.create(agent, input);
    expect(!out.ok && out.status).toBe("invalid");
    expect(await countRows(services, publications)).toBe(0);
    expect(await countRows(services, submissionReceipts)).toBe(0);
    // Fixing the payload and retrying with the same externalId works.
    const retry = await services.publications.create(agent, { ...input, attachmentIds: [] });
    expect(retry.ok && retry.value.replayed).toBe(false);
  });

  it("rolls back every row when the database rejects part of the batch", async () => {
    const services = createTestServices();
    const agent = agentFor(await memberActor(services, "editor@example.test"));
    // Make revision inserts fail inside the transaction (test-only trigger).
    services.sqlite.exec(`CREATE TRIGGER test_fail_revision BEFORE INSERT ON publication_revisions BEGIN SELECT RAISE(ABORT, 'test failure'); END;`);
    const out = await services.publications.create(agent, storyInput());
    expect(!out.ok && out.status).toBe("unavailable");
    expect(await countRows(services, publications)).toBe(0);
    expect(await countRows(services, submissionReceipts)).toBe(0);
    services.sqlite.exec(`DROP TRIGGER test_fail_revision`);
  });
});

describe("agent ownership and role rules (A6, core)", () => {
  it("lets an agent update only its member's publications, as editor or owner", async () => {
    const services = createTestServices();
    const memberA = await memberActor(services, "a@example.test");
    const memberB = await memberActor(services, "b@example.test");
    const created = await services.publications.create(agentFor(memberA), storyInput());
    if (!created.ok) throw new Error(created.message);
    const id = created.value.publication.id;

    const byB = await services.publications.update(agentFor(memberB), id, { expectedRevision: 1, title: "Hijack (test)" });
    expect(!byB.ok && byB.status).toBe("forbidden");
    // A's new credential still updates A's item.
    const byNewKey = await services.publications.update(agentFor(memberA, { credentialId: "key-new" }), id, { expectedRevision: 1, title: "Fixed (test)" });
    expect(byNewKey.ok).toBe(true);
    // Demoted to reader: no writes.
    const demoted = await services.publications.update({ ...agentFor(memberA), role: "reader" }, id, { expectedRevision: 2, title: "Nope (test)" });
    expect(!demoted.ok && demoted.status).toBe("forbidden");
    const readerCreate = await services.publications.create({ ...agentFor(memberA), role: "reader" }, storyInput());
    expect(!readerCreate.ok && readerCreate.status).toBe("forbidden");
  });

  it("hides another member's unpublished item as not found", async () => {
    const services = createTestServices();
    const editor = await memberActor(services, "editor@example.test");
    const memberB = await memberActor(services, "b@example.test");
    const draft = await services.publications.create(editor, storyInput(), { publish: false });
    if (!draft.ok) throw new Error(draft.message);
    const out = await services.publications.update(agentFor(memberB), draft.value.publication.id, { expectedRevision: 1, title: "x" });
    expect(!out.ok && out.status).toBe("not_found");
    expect(await services.publications.getForAgent(agentFor(memberB), draft.value.publication.id)).toBeNull();
  });

  it("records agent creator and label for attribution; editor changes keep the creator", async () => {
    const services = createTestServices();
    const member = await memberActor(services, "a@example.test");
    const editor = await memberActor(services, "editor@example.test");
    const created = await services.publications.create(agentFor(member, { credentialKind: "oauth", credentialId: "c1", label: "Research Bot" }), storyInput());
    if (!created.ok) throw new Error(created.message);
    const edited = await services.publications.update(editor, created.value.publication.id, { expectedRevision: 1, summary: "Edited (test)." });
    expect(edited.ok && edited.value.createdBy).toEqual({ userId: member.userId, name: "Test editor", kind: "agent", label: "Research Bot" });
  });

  it("never lets agents unpublish, restore, view history, or change the layout", async () => {
    const services = createTestServices();
    const owner = await memberActor(services, "owner2@example.test", "owner");
    const agent = agentFor(owner);
    const created = await services.publications.create(agent, storyInput());
    if (!created.ok) throw new Error(created.message);
    const id = created.value.publication.id;
    for (const out of [
      await services.publications.unpublish(agent, id, 1),
      await services.publications.restoreVisibility(agent, id, 1),
      await services.publications.restoreRevision(agent, id, 1, 1),
      await services.publications.history(agent, id),
      await services.homepage.setLayout(agent, []),
    ]) {
      expect(!out.ok && out.status).toBe("forbidden");
    }
  });

  it("records agent failures in the bounded failure log, not editor ones", async () => {
    const services = createTestServices();
    const editor = await memberActor(services, "editor@example.test");
    await services.publications.create(agentFor(editor), { externalId: "bad-1", type: "story" });
    await services.publications.create(editor, { type: "story" });
    const rows = await services.db.select().from(publishingFailures);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: editor.userId, operation: "create_publication", status: "invalid", externalId: "bad-1", credentialId: "test-key-1" });
  });
});

describe("A7: revisions", () => {
  it("rejects a stale expected revision without losing the newer change", async () => {
    const services = createTestServices();
    const editor = await memberActor(services, "editor@example.test");
    const other = await memberActor(services, "editor2@example.test");
    const created = await services.publications.create(editor, reportInput(), { publish: true });
    if (!created.ok) throw new Error(created.message);
    const id = created.value.publication.id;

    const first = await services.publications.update(editor, id, { expectedRevision: 1, title: "Editor one (test)" });
    const second = await services.publications.update(other, id, { expectedRevision: 1, title: "Editor two (test)" });
    expect(first.ok && first.value.revision).toBe(2);
    expect(!second.ok && second.status).toBe("conflict");
    expect(!second.ok && second.currentRevision).toBe(2);
    expect((await services.publications.getPublic(id))?.title).toBe("Editor one (test)");
  });

  it("lets exactly one of two concurrent updates at the same revision win", async () => {
    const services = createTestServices();
    const editor = await memberActor(services, "editor@example.test");
    const created = await services.publications.create(editor, storyInput(), { publish: true });
    if (!created.ok) throw new Error(created.message);
    const id = created.value.publication.id;
    const results = await Promise.all(
      ["A", "B", "C"].map((t) => services.publications.update(editor, id, { expectedRevision: 1, title: `Concurrent ${t} (test)`, tags: [t] })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.status === "conflict")).toHaveLength(2);
    const winner = results.find((r) => r.ok)!;
    const current = await services.publications.getPublic(id);
    expect(current?.revision).toBe(2);
    expect(current?.title).toBe(winner.ok ? winner.value.title : "");
    expect(current?.tags).toHaveLength(1);
    const [revs] = await services.db.select({ n: count() }).from(publicationRevisions).where(eq(publicationRevisions.publicationId, id));
    expect(revs!.n).toBe(2);
  });

  it("guards the write itself when two updates both pass the revision check", async () => {
    const services = createTestServices();
    const editor = await memberActor(services, "editor@example.test");
    const created = await services.publications.create(editor, storyInput({ tags: ["start"] }), { publish: true });
    if (!created.ok) throw new Error(created.message);
    const id = created.value.publication.id;
    const repo = createPublicationsRepository(services.db);
    holdFirstCalls(repo, "get");
    const racing = servicesWithRepo(services, repo);
    const [a, b] = await Promise.all([
      racing.update(editor, id, { expectedRevision: 1, title: "Race A (test)", tags: ["a"] }),
      racing.update(editor, id, { expectedRevision: 1, title: "Race B (test)", tags: ["b"] }),
    ]);
    expect([a.ok ? "ok" : a.status, b.ok ? "ok" : b.status].sort()).toEqual(["conflict", "ok"]);
    const winner = (a.ok ? a : b) as Extract<typeof a, { ok: true }>;
    const current = await services.publications.getPublic(id);
    expect(current).toMatchObject({ revision: 2, title: winner.value.title });
    expect(current!.tags.map((t) => t.name)).toEqual(winner.value.tags.map((t) => t.name));
    const revs = await services.db.select().from(publicationRevisions).where(eq(publicationRevisions.publicationId, id));
    expect(revs.map((r) => r.revision).sort()).toEqual([1, 2]);
  });

  it("records actor and time for every change; restoring appends a new revision and keeps visibility", async () => {
    const clock = testClock();
    const services = createTestServices({ now: clock.now });
    const editor = await memberActor(services, "editor@example.test");
    const agent = agentFor(editor, { label: "Test bot" });
    const created = await services.publications.create(agent, reportInput({ title: "Original (test)" }));
    if (!created.ok) throw new Error(created.message);
    const id = created.value.publication.id;
    clock.advance(60_000);
    await services.publications.update(editor, id, { expectedRevision: 1, title: "Second (test)" });
    clock.advance(60_000);
    await services.publications.unpublish(editor, id, 2);
    clock.advance(60_000);
    const restored = await services.publications.restoreRevision(editor, id, 1, 3);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value).toMatchObject({ revision: 4, title: "Original (test)", status: "unpublished" });

    const history = await services.publications.history(editor, id);
    if (!history.ok) throw new Error(history.message);
    expect(history.value.map((h) => [h.revision, h.status, h.actor.kind])).toEqual([
      [4, "unpublished", "member"],
      [3, "unpublished", "member"],
      [2, "published", "member"],
      [1, "published", "agent"],
    ]);
    expect(history.value[3]!.actor.label).toBe("Test bot");
    expect(history.value[0]!.createdAt.toISOString()).toBe("2026-11-06T15:03:00.000Z");
    const r1 = await services.publications.getRevision(editor, id, 1);
    expect(r1.ok && r1.value.content.title).toBe("Original (test)");
    const r2 = await services.publications.getRevision(editor, id, 2);
    expect(r2.ok && r2.value.content.title).toBe("Second (test)");
  });

  it("does not add a revision when an update changes nothing", async () => {
    const services = createTestServices();
    const agent = agentFor(await memberActor(services, "editor@example.test"));
    const created = await services.publications.create(agent, storyInput({ tags: ["x"] }));
    if (!created.ok) throw new Error(created.message);
    const same = await services.publications.update(agent, created.value.publication.id, { expectedRevision: 1, tags: ["X"] });
    expect(same.ok && same.value.revision).toBe(1);
  });

  it("keeps publication time on edits so old items do not move to the top", async () => {
    const clock = testClock();
    const services = createTestServices({ now: clock.now });
    const agent = agentFor(await memberActor(services, "editor@example.test"));
    const old = await services.publications.create(agent, storyInput({ title: "Old (test)" }));
    clock.advance(3_600_000);
    await services.publications.create(agent, storyInput({ title: "New (test)" }));
    clock.advance(3_600_000);
    if (!old.ok) throw new Error(old.message);
    const edited = await services.publications.update(agent, old.value.publication.id, { expectedRevision: 1, summary: "Edited (test)." });
    expect(edited.ok && edited.value.publishedAt?.toISOString()).toBe("2026-11-06T15:00:00.000Z");
    expect(edited.ok && edited.value.updatedAt.toISOString()).toBe("2026-11-06T17:00:00.000Z");
    const page = await services.publications.listPublished({});
    expect(page.items.map((p) => p.title)).toEqual(["New (test)", "Old (test)"]);
  });
});

describe("A8 (core): visibility", () => {
  it("drafts are private until published; unpublish hides; agent updates cannot republish; restore returns it", async () => {
    const services = createTestServices();
    const editor = await memberActor(services, "editor@example.test");
    const agent = agentFor(editor);
    const draft = await services.publications.create(editor, storyInput({ title: "Draft (test)" }));
    if (!draft.ok) throw new Error(draft.message);
    const draftId = draft.value.publication.id;
    expect(draft.value.publication.status).toBe("draft");
    expect(await services.publications.getPublic(draftId)).toBeNull();
    const published = await services.publications.publish(editor, draftId, 1);
    expect(published.ok && published.value.status).toBe("published");

    const created = await services.publications.create(agent, storyInput({ title: "Agent item (test)", category: "Hidden Topic" }));
    if (!created.ok) throw new Error(created.message);
    const id = created.value.publication.id;
    const un = await services.publications.unpublish(editor, id, 1);
    expect(un.ok && un.value.status).toBe("unpublished");
    expect(await services.publications.getPublic(id)).toBeNull();
    expect((await services.publications.listPublished({})).items.map((p) => p.id)).not.toContain(id);
    expect((await services.categories.listWithPublished()).map((c) => c.name)).not.toContain("Hidden Topic");
    // The agent can still read and correct its member's own item, but it stays unpublished.
    expect((await services.publications.getForAgent(agent, id))?.status).toBe("unpublished");
    const fix = await services.publications.update(agent, id, { expectedRevision: 2, title: "Corrected (test)" });
    expect(fix.ok && fix.value.status).toBe("unpublished");
    expect(await services.publications.getPublic(id)).toBeNull();

    const back = await services.publications.restoreVisibility(editor, id, 3);
    expect(back.ok && back.value).toMatchObject({ status: "published", title: "Corrected (test)", revision: 4 });
    expect((await services.publications.getPublic(id))?.publishedAt?.getTime()).toBe(created.value.publication.publishedAt?.getTime());
  });

  it("rejects status changes that do not apply", async () => {
    const services = createTestServices();
    const editor = await memberActor(services, "editor@example.test");
    const draft = await services.publications.create(editor, storyInput());
    if (!draft.ok) throw new Error(draft.message);
    const out = await services.publications.unpublish(editor, draft.value.publication.id, 1);
    expect(!out.ok && out.status).toBe("invalid");
    const stale = await services.publications.publish(editor, draft.value.publication.id, 5);
    expect(!stale.ok && stale.status).toBe("conflict");
  });
});

describe("homepage layout and panels", () => {
  it("lets editors choose and order panels, and fills panels with the five newest published items", async () => {
    const clock = testClock();
    const services = createTestServices({ now: clock.now });
    const editor = await memberActor(services, "editor@example.test");
    const agent = agentFor(editor);
    for (let i = 0; i < 7; i++) {
      clock.advance(1000);
      await services.publications.create(agent, storyInput({ title: `Item ${i} (test)`, category: i % 2 ? "Science" : "Technology" }));
    }
    const science = (await services.categories.listAll()).find((c) => c.name === "Science")!;
    const tech = (await services.categories.listAll()).find((c) => c.name === "Technology")!;
    const set = await services.homepage.setLayout(editor, [science.id, tech.id]);
    expect(set.ok && set.value.map((c) => c.name)).toEqual(["Science", "Technology"]);
    const reader = { kind: "member" as const, userId: editor.userId, role: "reader" as const };
    expect((await services.homepage.setLayout(reader, [tech.id])).ok).toBe(false);
    expect((await services.homepage.setLayout(editor, [tech.id, tech.id])).ok).toBe(false);
    expect((await services.homepage.setLayout(editor, ["missing"])).ok).toBe(false);

    const panels = await services.publications.latestPerCategory([science.id, tech.id]);
    expect(panels.get(tech.id)!.map((p) => p.title)).toEqual(["Item 6 (test)", "Item 4 (test)", "Item 2 (test)", "Item 0 (test)"]);
    expect(panels.get(science.id)).toHaveLength(3);
    const p = (await services.publications.listPublished({ categoryId: tech.id })).items[1]!;
    const related = await services.publications.related(p);
    expect(related.map((r) => r.title)).toEqual(["Item 6 (test)", "Item 2 (test)", "Item 0 (test)"]);
  });
});
