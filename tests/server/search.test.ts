// A10: search over FTS5 with filters and Chicago dates. All content is test data.
import { describe, expect, it } from "vitest";
import { agentFor, memberActor, reportInput, storyInput, testClock } from "../helpers/publishing";
import { createTestServices } from "../helpers/services";

async function setup() {
  const clock = testClock("2024-01-15T18:00:00.000Z");
  const services = createTestServices({ now: clock.now });
  const editor = await memberActor(services, "editor@example.test");
  const agent = agentFor(editor);
  const create = async (input: Record<string, unknown>) => {
    const out = await services.publications.create(agent, input);
    if (!out.ok) throw new Error(out.message);
    return out.value.publication;
  };
  return { clock, services, editor, agent, create };
}

const titles = (r: { ok: boolean; value?: { items: Array<{ title: string }> } }) => (r.ok ? r.value!.items.map((i) => i.title) : null);

describe("A10: keyword search", () => {
  it("finds title, summary, and body matches, and keeps old publications searchable", async () => {
    const { clock, services, create } = await setup();
    await create(storyInput({ title: "Glacier melt accelerates (test)" }));
    clock.set("2026-11-06T15:00:00.000Z");
    await create(storyInput({ title: "Summary match (test)", summary: "A note about glacier monitoring (test data)." }));
    await create(reportInput({ title: "Body match (test)", bodyMarkdown: "## Notes\nField teams measured the glaciers' retreat (test data)." }));
    await create(storyInput({ title: "Unrelated (test)" }));

    const out = await services.search.publicSearch({ q: "glacier" });
    expect(titles(out)?.sort()).toEqual(["Glacier melt accelerates (test)", "Summary match (test)"].sort());
    // Prefix-free exact terms: "glaciers'" tokenizes to "glaciers".
    expect(titles(await services.search.publicSearch({ q: "glaciers" }))).toEqual(["Body match (test)"]);
    // Diacritics are folded.
    expect(titles(await services.search.publicSearch({ q: "GLÂCIER" }))?.length).toBe(2);
  });

  it("ranks by relevance, then newest; browsing without a query is newest first", async () => {
    const { clock, services, create } = await setup();
    await create(storyInput({ title: "Solar solar solar (test)", summary: "solar (test data)" }));
    clock.advance(60_000);
    await create(storyInput({ title: "Mentions solar once (test)" }));
    clock.advance(60_000);
    await create(storyInput({ title: "Newest unrelated (test)" }));
    expect(titles(await services.search.publicSearch({ q: "solar" }))).toEqual(["Solar solar solar (test)", "Mentions solar once (test)"]);
    expect(titles(await services.search.publicSearch({}))).toEqual(["Newest unrelated (test)", "Mentions solar once (test)", "Solar solar solar (test)"]);
  });

  it("never passes raw input to MATCH", async () => {
    const { services, create } = await setup();
    await create(storyInput({ title: "Quoted words (test)" }));
    for (const q of ['"', "AND OR NOT", "title:*", "(((", "NEAR(a b)", "'; drop table publications; --", "*"]) {
      const out = await services.search.publicSearch({ q });
      expect(out.ok, q).toBe(true);
    }
    expect(titles(await services.search.publicSearch({ q: 'quoted" OR "x' }))).toEqual([]);
  });

  it("applies category, type, and date filters with AND", async () => {
    const { clock, services, create } = await setup();
    clock.set("2026-03-01T17:00:00.000Z");
    await create(storyInput({ title: "Tech story March (test)", category: "Technology" }));
    await create(reportInput({ title: "Tech report March (test)", category: "Technology" }));
    await create(storyInput({ title: "Sports story March (test)", category: "Sports" }));
    clock.set("2026-04-01T17:00:00.000Z");
    await create(storyInput({ title: "Tech story April (test)", category: "Technology" }));

    expect(titles(await services.search.publicSearch({ category: "technology", type: "story" }))).toEqual(["Tech story April (test)", "Tech story March (test)"]);
    expect(titles(await services.search.publicSearch({ q: "march", category: "technology", type: "report" }))).toEqual(["Tech report March (test)"]);
    expect(titles(await services.search.publicSearch({ from: "2026-03-01", to: "2026-03-31", category: "technology" }))?.sort()).toEqual(
      ["Tech report March (test)", "Tech story March (test)"].sort(),
    );
    expect(titles(await services.search.publicSearch({ category: "no-such-category" }))).toEqual([]);
    const bad = await services.search.publicSearch({ from: "2026-04-02", to: "2026-04-01" });
    expect(!bad.ok && bad.errors?.to).toBeTruthy();
    expect((await services.search.publicSearch({ from: "2026-02-30" })).ok).toBe(false);
  });

  it("treats date filters as inclusive America/Chicago calendar days", async () => {
    const { clock, services, create } = await setup();
    // 2026-11-07 04:30 UTC is still 2026-11-06 in Chicago (CST, UTC-6).
    clock.set("2026-11-07T04:30:00.000Z");
    await create(storyInput({ title: "Late evening Chicago (test)" }));
    // 2026-07-01 04:59 UTC is 2026-06-30 23:59 in Chicago (CDT, UTC-5).
    clock.set("2026-07-01T04:59:00.000Z");
    await create(storyInput({ title: "Summer edge (test)" }));

    expect(titles(await services.search.publicSearch({ from: "2026-11-06", to: "2026-11-06" }))).toEqual(["Late evening Chicago (test)"]);
    expect(titles(await services.search.publicSearch({ from: "2026-11-07" }))).toEqual([]);
    expect(titles(await services.search.publicSearch({ to: "2026-06-30" }))).toEqual(["Summer edge (test)"]);
    expect(titles(await services.search.publicSearch({ from: "2026-07-01", to: "2026-07-01" }))).toEqual([]);
  });

  it("never returns drafts, unpublished items, or old revisions", async () => {
    const { services, editor, create } = await setup();
    const p = await create(storyInput({ title: "Original zebra headline (test)" }));
    await services.publications.update(editor, p.id, { expectedRevision: 1, title: "Current okapi headline (test)" });
    await services.publications.create(editor, storyInput({ title: "Draft zebra (test)" }));

    expect(titles(await services.search.publicSearch({ q: "zebra" }))).toEqual([]);
    expect(titles(await services.search.publicSearch({ q: "okapi" }))).toEqual(["Current okapi headline (test)"]);
    await services.publications.unpublish(editor, p.id, 2);
    expect(titles(await services.search.publicSearch({ q: "okapi" }))).toEqual([]);
    expect(titles(await services.search.publicSearch({}))).toEqual([]);
    await services.publications.restoreVisibility(editor, p.id, 3);
    expect(titles(await services.search.publicSearch({ q: "okapi" }))).toEqual(["Current okapi headline (test)"]);
  });

  it("lets an agent browse its member's own unpublished items, but not another member's", async () => {
    const { services, editor, agent, create } = await setup();
    const p = await create(storyInput({ title: "Own item (test)" }));
    await services.publications.unpublish(editor, p.id, 1);
    const other = agentFor(await memberActor(services, "other@example.test"));
    expect(titles(await services.search.agentSearch(agent, {}))).toEqual(["Own item (test)"]);
    expect(titles(await services.search.agentSearch(other, {}))).toEqual([]);
  });

  it("paginates 20 per page with stable ordering", async () => {
    const { services, create } = await setup();
    for (let i = 0; i < 25; i++) await create(storyInput({ title: `Same time ${i} (test)` }));
    const p1 = await services.search.publicSearch({ page: 1 });
    const p2 = await services.search.publicSearch({ page: 2 });
    if (!p1.ok || !p2.ok) throw new Error("search failed");
    expect(p1.value.total).toBe(25);
    expect(p1.value.items).toHaveLength(20);
    expect(p2.value.items).toHaveLength(5);
    const ids = [...p1.value.items, ...p2.value.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(25);
    expect(ids).toEqual([...ids].sort().reverse()); // same timestamp → id desc
  });
});
