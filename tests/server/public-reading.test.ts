// Lane 2B: public reading pages and attachment serving. Loaders are called directly with real services
// over in-memory SQLite. Every identity and publication here is test data, not real news.
import { describe, expect, it } from "vitest";
import { requireRoleWrite } from "../../app/access.server";
import { loader as categoriesLoader } from "../../app/routes/categories";
import { loader as categoryLoader } from "../../app/routes/category";
import { loader as homeLoader } from "../../app/routes/home";
import { loader as publicationLoader } from "../../app/routes/publication";
import { loader as robotsLoader } from "../../app/routes/robots";
import { loader as searchLoader } from "../../app/routes/search";
import { loader as sitemapLoader } from "../../app/routes/sitemap";
import { publicationPath, type Publication } from "../../server/core/publications";
import type { Services } from "../../server/app";
import { agentFor, memberActor, PNG_BYTES, reportInput, storyInput, streamText, testClock, uploadImage } from "../helpers/publishing";
import { run } from "../helpers/routes";
import { BASE_URL, createTestServices, request, sessionCookieFor } from "../helpers/services";

const get = (path: string, headers: Record<string, string> = {}) => new Request(`${BASE_URL}${path}`, { headers });

type Panels = { panels: Array<{ category: { name: string }; items: Array<{ id: string }> }> };
type ListPage = { results: { items: Array<{ id: string }>; total: number; page: number } };
type SearchData = { results: { items: Array<{ id: string; title: string }>; total: number } | null; errors: Record<string, string[]> | null; noSearchableWords: boolean };

async function homeIds(services: Services) {
  const { data } = await run(homeLoader, services, get("/"));
  return (data as Panels).panels.flatMap((p) => p.items.map((i) => i.id));
}
async function searchIds(services: Services, query: string) {
  const { data } = await run(searchLoader, services, get(`/search?${query}`));
  return ((data as SearchData).results?.items ?? []).map((i) => i.id);
}
async function categoryIds(services: Services, slug: string, query = "") {
  const out = await run(categoryLoader, services, get(`/categories/${slug}${query}`), { slug });
  return out.status === 200 ? (out.data as ListPage).results.items.map((i) => i.id) : out.status;
}
async function detail(services: Services, p: Publication) {
  return run(publicationLoader, services, get(publicationPath(p)), { id: p.id, slug: publicationPath(p).split("/").pop() });
}
async function sitemap(services: Services) {
  const { response } = await run(sitemapLoader, services, get("/sitemap.xml"));
  return response!.text();
}

async function published(services: Services, input: Record<string, unknown> = storyInput()) {
  const editor = await memberActor(services, `editor-${crypto.randomUUID()}@example.test`);
  const out = await services.publications.create(editor, input, { publish: true });
  if (!out.ok) throw new Error(out.message);
  return { editor, publication: out.value.publication };
}

describe("A1: anonymous visitors read public pages", () => {
  it("home shows only categories with items from the last 24 hours: preferred order first, then the rest newest first", async () => {
    const clock = testClock();
    const services = createTestServices({ now: clock.now });
    const editor = await memberActor(services, "editor@example.test");
    const publish = async (category: string) => {
      clock.advance(60_000);
      const out = await services.publications.create(editor, storyInput({ category }), { publish: true });
      if (!out.ok) throw new Error(out.message);
      return out.value.publication.id;
    };
    const oldFinance = await publish("Finance");
    clock.advance(25 * 60 * 60 * 1000);
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push(await publish("Technology"));
    await publish("Space Weather");
    await publish("Deep Sea");
    await publish("Business");
    const { status, data } = await run(homeLoader, services, get("/"));
    expect(status).toBe(200);
    const panels = (data as Panels).panels;
    // Seeded order is Technology, Business, Finance, Sports, Entertainment. Finance's only item is over
    // 24 hours old and Sports/Entertainment are empty, so they are hidden; new categories follow, newest first.
    expect(panels.map((p) => p.category.name)).toEqual(["Technology", "Business", "Deep Sea", "Space Weather"]);
    expect(panels[0]!.items.map((i) => i.id)).toEqual(ids.slice(2).reverse());
    expect(panels.flatMap((p) => p.items.map((i) => i.id))).not.toContain(oldFinance);
  });

  it("a new category appears on the homepage with its first item and leaves once nothing is recent", async () => {
    const clock = testClock();
    const services = createTestServices({ now: clock.now });
    const { publication } = await published(services, storyInput({ category: "Space Weather" }));
    expect(await homeIds(services)).toContain(publication.id);
    const { data } = await run(categoriesLoader, services, get("/categories"));
    expect((data as { categories: Array<{ slug: string; publishedCount: number }> }).categories).toEqual([
      expect.objectContaining({ slug: "space-weather", publishedCount: 1 }),
    ]);
    expect(await categoryIds(services, "space-weather")).toEqual([publication.id]);

    clock.advance(24 * 60 * 60 * 1000 + 1);
    const later = (await run(homeLoader, services, get("/"))).data as Panels & { fallback: Array<{ id: string }> };
    expect(later.panels).toEqual([]);
    // With nothing recent, the newest items site-wide are listed instead of a blank page.
    expect(later.fallback.map((i) => i.id)).toEqual([publication.id]);
  });

  it("category pages filter by type and paginate 20 per page, newest first", async () => {
    const clock = testClock();
    const services = createTestServices({ now: clock.now });
    const editor = await memberActor(services, "editor@example.test");
    for (let i = 0; i < 22; i++) {
      clock.advance(60_000);
      await services.publications.create(editor, i % 2 ? reportInput({ category: "Finance" }) : storyInput({ category: "Finance" }), { publish: true });
    }
    const page1 = await run(categoryLoader, services, get("/categories/finance"), { slug: "finance" });
    expect((page1.data as ListPage).results).toMatchObject({ total: 22, page: 1 });
    expect((page1.data as ListPage).results.items).toHaveLength(20);
    const page2 = await run(categoryLoader, services, get("/categories/finance?page=2"), { slug: "finance" });
    expect((page2.data as ListPage).results.items).toHaveLength(2);
    const reports = await run(categoryLoader, services, get("/categories/finance?type=report"), { slug: "finance" });
    expect((reports.data as ListPage).results.total).toBe(11);
    // An unknown type value is ignored rather than failing.
    const junk = await run(categoryLoader, services, get("/categories/finance?type=<script>&page=-3"), { slug: "finance" });
    expect((junk.data as ListPage).results).toMatchObject({ total: 22, page: 1 });
  });

  it("an empty homepage category shows an empty state; unknown categories are 404", async () => {
    const services = createTestServices();
    expect(await categoryIds(services, "sports")).toEqual([]);
    expect(await categoryIds(services, "no-such-category")).toBe(404);
  });

  it("publication detail shows the rendered body, attribution, sources, and up to five related items", async () => {
    const clock = testClock();
    const services = createTestServices({ now: clock.now });
    const owner = await memberActor(services, "agent-owner@example.test");
    const agent = agentFor(owner, { label: "Research bot" });
    for (let i = 0; i < 6; i++) {
      clock.advance(60_000);
      await services.publications.create(agent, storyInput({ category: "Business" }));
    }
    clock.advance(60_000);
    const created = await services.publications.create(
      agent,
      reportInput({
        category: "Business",
        bodyMarkdown: "## Findings\nTest body <script>alert(1)</script> [bad](javascript:alert(1))",
        sources: [{ url: "https://example.test/source", label: "Example source (test data)" }],
        tags: ["briefing"],
      }),
    );
    if (!created.ok) throw new Error(created.message);
    const p = created.value.publication;
    const { status, data } = await detail(services, p);
    expect(status).toBe(200);
    const d = data as { publication: Record<string, unknown>; bodyHtml: string; related: Array<{ id: string }>; canonicalUrl: string };
    expect(d.publication).toMatchObject({ title: p.title, byline: "Test editor via Research bot", sources: [{ url: "https://example.test/source" }] });
    expect(d.publication).not.toHaveProperty("bodyMarkdown");
    expect(d.bodyHtml).toContain("<h2>Findings</h2>");
    expect(d.bodyHtml).not.toMatch(/<script|href="javascript:/i);
    expect(d.related).toHaveLength(5);
    expect(d.related.map((r) => r.id)).not.toContain(p.id);
    expect(d.canonicalUrl).toBe(`${BASE_URL}${publicationPath(p)}`);
  });

  it("a wrong or missing slug redirects to the canonical path; unknown IDs are 404", async () => {
    const services = createTestServices();
    const { publication } = await published(services);
    const wrong = await run(publicationLoader, services, get(`/publications/${publication.id}/old-title`), { id: publication.id, slug: "old-title" });
    expect(wrong.status).toBe(301);
    expect(wrong.response!.headers.get("location")).toBe(publicationPath(publication));
    const bare = await run(publicationLoader, services, get(`/publications/${publication.id}`), { id: publication.id });
    expect(bare.status).toBe(301);
    expect((await run(publicationLoader, services, get("/publications/nope/x"), { id: "nope", slug: "x" })).status).toBe(404);
    // Client navigations fetch `<path>.data`; the canonical slug must not redirect there.
    const slug = publicationPath(publication).split("/").pop();
    expect((await run(publicationLoader, services, get(`${publicationPath(publication)}.data`), { id: publication.id, slug })).status).toBe(200);
  });

  it("the sitemap lists only public URLs, and robots.txt points to it", async () => {
    const services = createTestServices();
    const { publication } = await published(services, storyInput({ category: "R&D <Lab>" }));
    const xml = await sitemap(services);
    expect(xml).toContain(`<loc>${BASE_URL}/</loc>`);
    expect(xml).toContain(`<loc>${BASE_URL}/categories/r-d-lab</loc>`);
    expect(xml).toContain(`<loc>${BASE_URL}${publicationPath(publication)}</loc>`);
    expect(xml).not.toMatch(/<loc>[^<]*\/(sign-in|editor|dashboard|saved|owner|account)/);
    const { response } = await run(robotsLoader, services, get("/robots.txt"));
    const robots = await response!.text();
    expect(robots).toContain(`Sitemap: ${BASE_URL}/sitemap.xml`);
    expect(robots).not.toMatch(/Disallow: \/$/m);
  });
});

describe("A1: protected writes fail without authentication", () => {
  it("agent endpoints and page writes refuse anonymous requests, and nothing is created", async () => {
    const services = createTestServices();
    const body = JSON.stringify(storyInput());
    const headers = { "Content-Type": "application/json", Origin: BASE_URL };
    // 503 until lane 2A builds these, 401 after; either way never a success.
    for (const path of ["/api/v1/publications", "/mcp"]) {
      const response = await request(services, path, { method: "POST", headers, body });
      expect(response.status, path).toBeGreaterThanOrEqual(400);
    }
    const editor = await memberActor(services, "editor@example.test");
    const list = await services.publications.listForEditor(editor);
    expect(list.ok && list.value.total).toBe(0);
  });

  it("page write actions refuse a signed-out visitor with 401 (the guard every editor/owner action starts with)", async () => {
    const services = createTestServices();
    const post = new Request(`${BASE_URL}/editor`, { method: "POST", headers: { Origin: BASE_URL } });
    const thrown = await requireRoleWrite(post, services, "editor").catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(401);
  });
});

describe("A8 (public side): unpublished items vanish from every public surface", () => {
  it("drafts are never public", async () => {
    const services = createTestServices();
    const editor = await memberActor(services, "editor@example.test");
    const draft = await services.publications.create(editor, storyInput({ title: "Draft zebra headline", category: "Hidden Drafts" }));
    if (!draft.ok) throw new Error(draft.message);
    const p = draft.value.publication;
    expect(p.status).toBe("draft");
    expect((await detail(services, p)).status).toBe(404);
    expect(await searchIds(services, "q=zebra")).toEqual([]);
    expect(await categoryIds(services, "hidden-drafts")).toBe(404);
    expect(await sitemap(services)).not.toContain(p.id);
  });

  it("unpublish hides it everywhere and blocks its attachment; an agent update cannot republish; restore brings it back", async () => {
    const clock = testClock();
    const services = createTestServices({ now: clock.now });
    const member = await memberActor(services, "member@example.test");
    const agent = agentFor(member);
    const attachmentId = await uploadImage(services, agent);
    clock.advance(60_000);
    const other = await services.publications.create(agent, storyInput({ category: "Technology" }));
    clock.advance(60_000);
    const created = await services.publications.create(
      agent,
      reportInput({ title: "Quokka migration report", category: "Technology", bodyMarkdown: `Body\n\n![Test chart](attachment:${attachmentId})` }),
    );
    if (!created.ok || !other.ok) throw new Error("create failed");
    const p = created.value.publication;
    const otherDetail = () => detail(services, other.value.publication).then((r) => (r.data as { related: Array<{ id: string }> }).related.map((x) => x.id));

    // Visible while published.
    expect(await homeIds(services)).toContain(p.id);
    expect(await categoryIds(services, "technology")).toContain(p.id);
    expect(await searchIds(services, "q=quokka")).toEqual([p.id]);
    expect((await detail(services, p)).status).toBe(200);
    expect(await otherDetail()).toContain(p.id);
    expect(await sitemap(services)).toContain(p.id);
    const visible = await request(services, `/attachments/${attachmentId}`);
    expect(visible.status).toBe(200);
    expect(visible.headers.get("cache-control")).toBe("public, max-age=300");
    expect(visible.headers.get("content-type")).toBe("image/png");
    expect(visible.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await streamText(visible.body!)).toEqual(PNG_BYTES);

    // Unpublish.
    const editor = await memberActor(services, "editor@example.test");
    const hidden = await services.publications.unpublish(editor, p.id, p.revision);
    if (!hidden.ok) throw new Error(hidden.message);
    const checkHidden = async () => {
      expect(await homeIds(services)).not.toContain(p.id);
      expect(await categoryIds(services, "technology")).not.toContain(p.id);
      expect(await searchIds(services, "q=quokka")).toEqual([]);
      expect(await searchIds(services, "category=technology")).not.toContain(p.id);
      expect((await detail(services, p)).status).toBe(404);
      expect(await otherDetail()).not.toContain(p.id);
      expect(await sitemap(services)).not.toContain(p.id);
      const { data } = await run(categoriesLoader, services, get("/categories"));
      expect((data as { categories: Array<{ slug: string; publishedCount: number }> }).categories).toEqual([
        expect.objectContaining({ slug: "technology", publishedCount: 1 }),
      ]);
      const anonymous = await request(services, `/attachments/${attachmentId}`);
      expect(anonymous.status).toBe(404);
      expect(anonymous.headers.get("cache-control")).toBe("no-store");
      // A signed-in reader is no different from an anonymous visitor.
      const reader = await sessionCookieFor(services, `reader-${crypto.randomUUID()}@example.test`, "reader");
      expect((await request(services, `/attachments/${attachmentId}`, { headers: { cookie: reader.cookie } })).status).toBe(404);
    };
    await checkHidden();

    // Editors still see it, privately and never cached.
    const editorCookie = await sessionCookieFor(services, "editor-viewer@example.test", "editor");
    const forEditor = await request(services, `/attachments/${attachmentId}`, { headers: { cookie: editorCookie.cookie } });
    expect(forEditor.status).toBe(200);
    expect(forEditor.headers.get("cache-control")).toBe("private, no-store");
    expect(forEditor.headers.get("vary")).toBe("Cookie");

    // An agent update to its own unpublished item keeps it hidden.
    const updated = await services.publications.update(agent, p.id, { expectedRevision: hidden.value.revision, title: "Quokka migration report, revised" });
    if (!updated.ok) throw new Error(updated.message);
    expect(updated.value.status).toBe("unpublished");
    await checkHidden();

    // Editor restore returns it to every surface.
    const restored = await services.publications.restoreVisibility(editor, p.id, updated.value.revision);
    if (!restored.ok) throw new Error(restored.message);
    expect(await searchIds(services, "q=quokka")).toEqual([p.id]);
    expect(await homeIds(services)).toContain(p.id);
    expect((await detail(services, restored.value)).status).toBe(200);
    expect((await request(services, `/attachments/${attachmentId}`)).status).toBe(200);
  });

  it("an attachment only referenced by an older revision is not public", async () => {
    const services = createTestServices();
    const member = await memberActor(services, "member@example.test");
    const agent = agentFor(member);
    const attachmentId = await uploadImage(services, agent);
    const created = await services.publications.create(agent, reportInput({ bodyMarkdown: `![Test chart](attachment:${attachmentId})` }));
    if (!created.ok) throw new Error(created.message);
    expect((await request(services, `/attachments/${attachmentId}`)).status).toBe(200);
    const updated = await services.publications.update(agent, created.value.publication.id, {
      expectedRevision: created.value.publication.revision,
      bodyMarkdown: "No image any more.",
    });
    expect(updated.ok).toBe(true);
    expect((await request(services, `/attachments/${attachmentId}`)).status).toBe(404);
  });

  it("serves HEAD without a body and 404s unknown or malformed IDs the same way", async () => {
    const services = createTestServices();
    const member = await memberActor(services, "member@example.test");
    const attachmentId = await uploadImage(services, agentFor(member));
    await services.publications.create(agentFor(member), reportInput({ bodyMarkdown: `![Test chart](attachment:${attachmentId})` }));
    const head = await request(services, `/attachments/${attachmentId}`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(PNG_BYTES.byteLength));
    expect(await head.text()).toBe("");
    for (const path of ["/attachments/unknown-id", "/attachments/", "/attachments/a/b", "/attachments/%E0%A4%A", "/attachments/..%2F..%2Fsecret"]) {
      const response = await request(services, path);
      expect(response.status, path).toBe(404);
    }
  });
});

describe("A10 through the search page", () => {
  async function seed() {
    const clock = testClock("2024-01-15T18:00:00.000Z");
    const services = createTestServices({ now: clock.now });
    const editor = await memberActor(services, "editor@example.test");
    const make = async (input: Record<string, unknown>, at: string) => {
      clock.set(at);
      const out = await services.publications.create(editor, input, { publish: true });
      if (!out.ok) throw new Error(out.message);
      return out.value.publication.id;
    };
    const old = await make(storyInput({ title: "Archive heron sighting", category: "Technology" }), "2024-01-15T18:00:00.000Z");
    const summary = await make(storyInput({ summary: "A heron in the summary (test data).", category: "Business" }), "2026-11-02T05:30:00.000Z");
    const body = await make(reportInput({ bodyMarkdown: "The heron appears only in this body.", category: "Technology" }), "2026-11-03T05:30:00.000Z");
    return { services, old, summary, body };
  }

  it("finds title, summary, and body matches, old items included", async () => {
    const { services, old, summary, body } = await seed();
    expect((await searchIds(services, "q=heron")).sort()).toEqual([old, summary, body].sort());
  });

  it("applies category, type, and inclusive Central Time date filters together", async () => {
    const { services, old, summary, body } = await seed();
    expect((await searchIds(services, "q=heron&category=technology")).sort()).toEqual([old, body].sort());
    expect(await searchIds(services, "q=heron&type=report")).toEqual([body]);
    // 2026-11-02T05:30Z is Nov 1 in Chicago (CDT ended Nov 1, so 11:30 PM CST Nov 1).
    expect(await searchIds(services, "q=heron&from=2026-11-01&to=2026-11-01")).toEqual([summary]);
    expect(await searchIds(services, "q=heron&from=2026-11-02")).toEqual([body]);
    expect(await searchIds(services, "q=heron&to=2025-12-31")).toEqual([old]);
    expect(await searchIds(services, "q=heron&category=technology&type=story&to=2025-12-31")).toEqual([old]);
  });

  it("browsing without keywords lists newest first; unknown categories return nothing", async () => {
    const { services, old, summary, body } = await seed();
    expect(await searchIds(services, "")).toEqual([body, summary, old]);
    expect(await searchIds(services, "category=no-such-category")).toEqual([]);
  });

  it("shows field errors for an invalid range or date and keeps the input", async () => {
    const { services } = await seed();
    const reversed = await run(searchLoader, services, get("/search?q=heron&from=2026-11-05&to=2026-11-01"));
    expect(reversed.status).toBe(400);
    const d = reversed.data as SearchData & { values: Record<string, string> };
    expect(d.errors?.to?.[0]).toMatch(/before the start date/);
    expect(d.values).toMatchObject({ q: "heron", from: "2026-11-05", to: "2026-11-01" });
    const badDate = await run(searchLoader, services, get("/search?from=2026-02-30"));
    expect((badDate.data as SearchData).errors?.from).toBeTruthy();
    const longQuery = await run(searchLoader, services, get(`/search?q=${"a".repeat(201)}`));
    expect((longQuery.data as SearchData).errors?.q).toBeTruthy();
  });

  it("flags a query with no searchable words instead of pretending it matched", async () => {
    const { services } = await seed();
    const { data } = await run(searchLoader, services, get("/search?q=%22%22%20!!!"));
    expect((data as SearchData).noSearchableWords).toBe(true);
  });
});
