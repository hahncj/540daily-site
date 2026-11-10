// Editor workspace (lane 2C): route loaders and actions over the real Stage 1 core and in-memory SQLite.
// Exit checks: A7 in the UI, A8 editor side, A14 end to end. Every identity and publication here is test data.
import { describe, expect, it } from "vitest";
import * as attachmentsRoute from "../../app/routes/editor.attachments";
import * as historyRoute from "../../app/routes/editor.history";
import * as homepageRoute from "../../app/routes/editor.homepage";
import * as newRoute from "../../app/routes/editor.new";
import * as publicationRoute from "../../app/routes/editor.publication";
import * as indexRoute from "../../app/routes/editor";
import type { Services } from "../../server/app";
import { agentFor, PNG_BYTES, storyInput, SVG_BYTES, uploadImage } from "../helpers/publishing";
import { run } from "../helpers/routes";
import { BASE_URL, createTestServices, request, sessionCookieFor } from "../helpers/services";

type Fields = Record<string, string>;

const FORM: Fields = {
  type: "story",
  title: "Test editor story",
  summary: "Test summary written in the editor (test data).",
  bodyMarkdown: "Test body (test data).",
  category: "Technology",
  tags: "test-tag",
  sources: "https://example.test/source Example source",
  sourcePublishedAt: "",
};

function get(path: string, cookie?: string) {
  return new Request(`${BASE_URL}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
}

function post(path: string, cookie: string | null, fields: Fields | FormData, origin = BASE_URL) {
  let body: FormData;
  if (fields instanceof FormData) body = fields;
  else {
    body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.append(k, v);
  }
  const headers: Record<string, string> = { Origin: origin };
  if (cookie) headers.Cookie = cookie;
  return new Request(`${BASE_URL}${path}`, { method: "POST", headers, body });
}

/** A multipart request as a browser sends it, with Content-Length. */
async function uploadPost(cookie: string, form: FormData) {
  const draft = new Request(`${BASE_URL}/editor/attachments`, { method: "POST", body: form });
  const bytes = await draft.arrayBuffer();
  return new Request(`${BASE_URL}/editor/attachments`, {
    method: "POST",
    headers: { Origin: BASE_URL, Cookie: cookie, "Content-Type": draft.headers.get("Content-Type")!, "Content-Length": String(bytes.byteLength) },
    body: bytes,
  });
}

const location = (r: { response?: Response }) => r.response?.headers.get("Location") ?? null;
const idFrom = (loc: string | null) => decodeURIComponent(/\/editor\/publications\/([^?/]+)/.exec(loc ?? "")?.[1] ?? "");

async function searchIds(services: Services, q: string) {
  const r = await services.search.publicSearch({ q });
  if (!r.ok) throw new Error(r.message);
  return r.value.items.map((p) => p.id);
}

async function setup() {
  const services = createTestServices();
  const editor = await sessionCookieFor(services, "editor@example.test", "editor");
  const actor = { kind: "member" as const, userId: editor.userId, role: "editor" as const };
  return { services, editor, actor };
}

async function createViaForm(services: Services, cookie: string, fields: Fields = {}, intent = "save") {
  const r = await run(newRoute.action, services, post("/editor/new", cookie, { ...FORM, ...fields, intent }));
  expect(r.status, JSON.stringify(r.data)).toBe(302);
  return idFrom(location(r));
}

async function edit(services: Services, cookie: string, id: string, fields: Fields) {
  return run(publicationRoute.action, services, post(`/editor/publications/${id}`, cookie, fields), { id });
}

describe("editor access is enforced on the server", () => {
  const pages = [
    { name: "list", fn: indexRoute.loader, path: "/editor", params: {} },
    { name: "new", fn: newRoute.loader, path: "/editor/new", params: {} },
    { name: "homepage", fn: homepageRoute.loader, path: "/editor/homepage", params: {} },
    { name: "edit", fn: publicationRoute.loader, path: "/editor/publications/x", params: { id: "x" } },
    { name: "history", fn: historyRoute.loader, path: "/editor/publications/x/history", params: { id: "x" } },
  ];

  it("sends visitors to sign-in and refuses readers on every editor page", async () => {
    const services = createTestServices();
    const reader = await sessionCookieFor(services, "reader@example.test", "reader");
    for (const page of pages) {
      const anon = await run(page.fn as never, services, get(page.path), page.params);
      expect(anon.status, page.name).toBe(302);
      expect(location(anon), page.name).toBe(`/sign-in?next=${encodeURIComponent(page.path)}`);
      const asReader = await run(page.fn as never, services, get(page.path, reader.cookie), page.params);
      expect(asReader.status, page.name).toBe(403);
    }
  });

  it("refuses writes from visitors, readers, and other origins", async () => {
    const { services, editor } = await setup();
    const reader = await sessionCookieFor(services, "reader@example.test", "reader");
    const actions: Array<{ fn: unknown; path: string; params: Record<string, string>; fields: Fields }> = [
      { fn: newRoute.action, path: "/editor/new", params: {}, fields: { ...FORM, intent: "save" } },
      { fn: publicationRoute.action, path: "/editor/publications/x", params: { id: "x" }, fields: { intent: "unpublish", expectedRevision: "1" } },
      { fn: historyRoute.action, path: "/editor/publications/x/history", params: { id: "x" }, fields: { revision: "1", expectedRevision: "1" } },
      { fn: homepageRoute.action, path: "/editor/homepage", params: {}, fields: { intent: "remove", categoryId: "x", order: "" } },
      { fn: attachmentsRoute.action, path: "/editor/attachments", params: {}, fields: { altText: "Test" } },
    ];
    for (const a of actions) {
      expect((await run(a.fn as never, services, post(a.path, null, a.fields), a.params)).status, a.path).toBe(401);
      expect((await run(a.fn as never, services, post(a.path, reader.cookie, a.fields), a.params)).status, a.path).toBe(403);
      expect((await run(a.fn as never, services, post(a.path, editor.cookie, a.fields, "https://evil.example"), a.params)).status, a.path).toBe(403);
    }
    // Nothing was created by any refused write.
    expect((await services.publications.listForEditor({ kind: "member", userId: editor.userId, role: "editor" })).ok).toBe(true);
    expect(services.sqlite.prepare("select count(*) as n from publications").get()).toEqual({ n: 0 });
  });

  it("lets the owner in, and marks editor pages noindex", async () => {
    const services = createTestServices();
    const owner = await sessionCookieFor(services, "owner@example.test", "owner");
    expect((await run(indexRoute.loader as never, services, get("/editor", owner.cookie))).status).toBe(200);
    for (const route of [indexRoute, newRoute, homepageRoute]) {
      expect((route.meta as (a: unknown) => unknown[])({})).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    }
    for (const path of ["/editor", "/editor/new", "/editor/homepage", "/editor/publications/x", "/editor/publications/x/history", "/editor/attachments"]) {
      expect((await request(services, path)).headers.get("x-robots-tag"), path).toBe("noindex");
    }
  });
});

describe("A14: editor creation, publication, editing, unpublish, history, restore, and homepage configuration", () => {
  it("runs the whole editorial cycle through the editor routes", async () => {
    const { services, editor } = await setup();

    // Create a private draft.
    const id = await createViaForm(services, editor.cookie);
    expect(await services.publications.getPublic(id)).toBeNull();
    const list = await run(indexRoute.loader as never, services, get("/editor?status=draft", editor.cookie));
    expect((list.data as { items: Array<{ id: string; status: string }> }).items).toEqual([expect.objectContaining({ id, status: "draft" })]);

    // Edit the draft, then save and publish in one step.
    expect(location(await edit(services, editor.cookie, id, { ...FORM, title: "Test story, edited", expectedRevision: "1", intent: "save" }))).toBe(`/editor/publications/${id}?done=saved`);
    expect(location(await edit(services, editor.cookie, id, { ...FORM, title: "Test story, published", expectedRevision: "2", intent: "save-publish" }))).toBe(
      `/editor/publications/${id}?done=published`,
    );
    const published = await services.publications.getPublic(id);
    expect(published).toMatchObject({ title: "Test story, published", status: "published", revision: 4 });
    expect(await searchIds(services, "published")).toContain(id);

    // Unpublish: gone from public detail and search.
    expect(location(await edit(services, editor.cookie, id, { intent: "unpublish", expectedRevision: "4" }))).toBe(`/editor/publications/${id}?done=unpublished`);
    expect(await services.publications.getPublic(id)).toBeNull();
    expect(await searchIds(services, "published")).not.toContain(id);

    // Restore visibility: back, keeping the original publication time.
    expect(location(await edit(services, editor.cookie, id, { intent: "restore-visibility", expectedRevision: "5" }))).toBe(`/editor/publications/${id}?done=restored`);
    expect((await services.publications.getPublic(id))?.publishedAt).toEqual(published?.publishedAt);

    // History lists every revision with the actor; restoring revision 1 appends revision 7.
    const history = await run(historyRoute.loader as never, services, get(`/editor/publications/${id}/history?revision=1`, editor.cookie), { id });
    const h = history.data as { revisions: Array<{ revision: number; status: string; actor: { name: string } }>; selected: { content: { title: string }; html: string } };
    expect(h.revisions.map((r) => [r.revision, r.status])).toEqual([
      [6, "published"],
      [5, "unpublished"],
      [4, "published"],
      [3, "draft"],
      [2, "draft"],
      [1, "draft"],
    ]);
    expect(h.revisions.every((r) => r.actor.name === "Test editor")).toBe(true);
    expect(h.selected.content.title).toBe("Test editor story");
    expect(h.selected.html).toContain("Test body (test data).");

    const restore = await run(historyRoute.action as never, services, post(`/editor/publications/${id}/history`, editor.cookie, { revision: "1", expectedRevision: "6" }), { id });
    expect(location(restore)).toBe(`/editor/publications/${id}/history?revision=7&done=restored&from=1`);
    const after = await services.publications.getPublic(id);
    expect(after).toMatchObject({ title: "Test editor story", revision: 7, status: "published" });

    // Homepage: the new category is absent until an editor adds it; then reorder and remove.
    const fresh = await createViaForm(services, editor.cookie, { category: "Test Category", title: "Test new-category story" }, "publish");
    expect(await services.publications.getPublic(fresh)).not.toBeNull();
    const names = async () => (await services.homepage.layout()).map((c) => c.name);
    expect(await names()).toEqual(["Technology", "Business", "Finance", "Sports", "Entertainment"]);

    const page = async () => (await run(homepageRoute.loader as never, services, get("/editor/homepage", editor.cookie))).data as { layout: Array<{ id: string; name: string }>; available: Array<{ id: string; name: string }> };
    const change = async (intent: string, name: string) => {
      const before = await page();
      const categoryId = [...before.layout, ...before.available].find((c) => c.name === name)!.id;
      const order = before.layout.map((c) => c.id).join(",");
      return run(homepageRoute.action as never, services, post("/editor/homepage", editor.cookie, { intent, categoryId, order }));
    };
    expect((await page()).available.map((c) => c.name)).toEqual(["Test Category"]);
    expect((await change("add", "Test Category")).data).toMatchObject({ ok: true, message: "Test Category added to the homepage at position 6." });
    expect((await change("up", "Test Category")).data).toMatchObject({ ok: true, message: "Test Category moved up to position 5 of 6.", focus: { intent: "up" } });
    expect(await names()).toEqual(["Technology", "Business", "Finance", "Sports", "Test Category", "Entertainment"]);
    await change("down", "Technology");
    await change("remove", "Sports");
    expect(await names()).toEqual(["Business", "Technology", "Finance", "Test Category", "Entertainment"]);
    // Moving the first item up is a no-op, not an error.
    await change("up", "Business");
    expect(await names()).toEqual(["Business", "Technology", "Finance", "Test Category", "Entertainment"]);
  });

  it("refuses a homepage change made against a layout that changed meanwhile", async () => {
    const { services, editor } = await setup();
    const layout = await services.homepage.layout();
    const stale = layout.map((c) => c.id).join(",");
    await run(homepageRoute.action as never, services, post("/editor/homepage", editor.cookie, { intent: "remove", categoryId: layout[0]!.id, order: stale }));
    const r = await run(homepageRoute.action as never, services, post("/editor/homepage", editor.cookie, { intent: "down", categoryId: layout[1]!.id, order: stale }));
    expect(r.status).toBe(409);
    expect((await services.homepage.layout()).map((c) => c.id)).toEqual(layout.slice(1).map((c) => c.id));
  });

  it("keeps the editor's input when validation fails, and creates nothing", async () => {
    const { services, editor } = await setup();
    const r = await run(newRoute.action, services, post("/editor/new", editor.cookie, { ...FORM, type: "report", bodyMarkdown: "  ", sources: "javascript:alert(1)", intent: "publish" }));
    expect(r.status).toBe(422);
    const d = r.data as { ok: boolean; errors: Record<string, string[]>; values: Fields };
    expect(d.ok).toBe(false);
    expect(d.errors.bodyMarkdown).toEqual(["Reports need a body."]);
    expect(d.errors.sources?.[0]).toMatch(/^Source 1: /);
    expect(d.values).toMatchObject({ title: FORM.title, summary: FORM.summary, sources: "javascript:alert(1)" });
    expect(services.sqlite.prepare("select count(*) as n from publications").get()).toEqual({ n: 0 });
  });

  it("shows a 404 for a publication that does not exist", async () => {
    const { services, editor } = await setup();
    expect((await run(publicationRoute.loader as never, services, get("/editor/publications/missing", editor.cookie), { id: "missing" })).status).toBe(404);
  });
});

describe("A7 in the UI: conflicting saves fail without lost changes", () => {
  it("rejects a stale save, keeps the second editor's input, and lets them save on top deliberately", async () => {
    const { services, editor } = await setup();
    const second = await sessionCookieFor(services, "editor2@example.test", "editor");
    const id = await createViaForm(services, editor.cookie, {}, "publish");

    // Both editors loaded revision 1. The first saves.
    await edit(services, editor.cookie, id, { ...FORM, title: "Test title from editor one", expectedRevision: "1", intent: "save" });
    // The second saves against revision 1: conflict, nothing written, input echoed back.
    const stale = await edit(services, second.cookie, id, { ...FORM, title: "Test title from editor two", expectedRevision: "1", intent: "save" });
    expect(stale.status).toBe(409);
    expect(stale.data).toMatchObject({ ok: false, currentRevision: 2, expectedRevision: 1, values: { title: "Test title from editor two" } });
    expect((await services.publications.getPublic(id))?.title).toBe("Test title from editor one");

    // Explicitly saving on top of revision 2 appends revision 3; revision 2 stays in history.
    const override = await edit(services, second.cookie, id, { ...FORM, title: "Test title from editor two", expectedRevision: "1", overrideRevision: "2" });
    expect(location(override)).toBe(`/editor/publications/${id}?done=saved`);
    const history = await run(historyRoute.loader as never, services, get(`/editor/publications/${id}/history?revision=2`, editor.cookie), { id });
    const h = history.data as { revisions: Array<{ revision: number; actor: { userId: string } }>; selected: { content: { title: string } } };
    expect(h.revisions.map((r) => [r.revision, r.actor.userId])).toEqual([
      [3, second.userId],
      [2, editor.userId],
      [1, editor.userId],
    ]);
    expect(h.selected.content.title).toBe("Test title from editor one");
  });

  it("rejects stale visibility changes and restores", async () => {
    const { services, editor } = await setup();
    const id = await createViaForm(services, editor.cookie, {}, "publish");
    await edit(services, editor.cookie, id, { ...FORM, title: "Test newer title", expectedRevision: "1", intent: "save" });
    expect((await edit(services, editor.cookie, id, { intent: "unpublish", expectedRevision: "1" })).status).toBe(409);
    expect((await services.publications.getPublic(id))?.status).toBe("published");
    const restore = await run(historyRoute.action as never, services, post(`/editor/publications/${id}/history`, editor.cookie, { revision: "1", expectedRevision: "1" }), { id });
    expect(restore.status).toBe(409);
    expect((await services.publications.getPublic(id))?.revision).toBe(2);
  });
});

describe("A8 editor side: unpublish hides content and attachments; agents cannot republish; restore returns it", () => {
  it("covers an agent's publication with an image", async () => {
    const { services, editor, actor } = await setup();
    const agentMember = { kind: "member" as const, userId: editor.userId, role: "editor" as const };
    const agent = agentFor(agentMember);
    const imageId = await uploadImage(services, agent);
    const created = await services.publications.create(agent, storyInput({ bodyMarkdown: `![Test chart](attachment:${imageId})` }));
    if (!created.ok) throw new Error(created.message);
    const id = created.value.publication.id;
    expect(await services.attachments.open(null, imageId)).toMatchObject({ visibility: "public" });

    expect(location(await edit(services, editor.cookie, id, { intent: "unpublish", expectedRevision: "1" }))).toContain("done=unpublished");
    expect(await services.publications.getPublic(id)).toBeNull();
    expect(await services.attachments.open(null, imageId)).toBeNull();
    // Editors still see it, and its image, privately.
    expect(await services.attachments.open({ userId: actor.userId, role: "editor", status: "active" }, imageId)).toMatchObject({ visibility: "private", cacheControl: "private, no-store" });

    // The agent may still correct its own item, but that never republishes it.
    const agentEdit = await services.publications.update(agent, id, { expectedRevision: 2, title: "Test title corrected by agent" });
    expect(agentEdit.ok && agentEdit.value.status).toBe("unpublished");
    expect(await services.publications.getPublic(id)).toBeNull();

    // The edit page shows the editor the restore action; restoring returns the item and its image.
    const page = await run(publicationRoute.loader as never, services, get(`/editor/publications/${id}`, editor.cookie), { id });
    expect((page.data as { publication: { status: string; revision: number } }).publication).toMatchObject({ status: "unpublished", revision: 3 });
    expect(location(await edit(services, editor.cookie, id, { intent: "restore-visibility", expectedRevision: "3" }))).toContain("done=restored");
    expect(await services.publications.getPublic(id)).toMatchObject({ title: "Test title corrected by agent", status: "published" });
    expect(await services.attachments.open(null, imageId)).toMatchObject({ visibility: "public" });
  });

  it("keeps drafts out of public view until published", async () => {
    const { services, editor } = await setup();
    const id = await createViaForm(services, editor.cookie, { title: "Test private draft" });
    expect(await services.publications.getPublic(id)).toBeNull();
    expect(await searchIds(services, "private draft")).toEqual([]);
    expect(location(await edit(services, editor.cookie, id, { intent: "publish", expectedRevision: "1" }))).toContain("done=published");
    expect(await services.publications.getPublic(id)).not.toBeNull();
    // Publishing twice is refused, not repeated.
    expect((await edit(services, editor.cookie, id, { intent: "publish", expectedRevision: "2" })).status).toBe(422);
  });
});

describe("preview and uploads", () => {
  it("previews through the public renderer, safely, without saving", async () => {
    const { services, editor, actor } = await setup();
    const imageId = await uploadImage(services, actor);
    const body = `# Heading\n<script>alert(1)</script>\n[x](javascript:alert(1))\n![Test chart](attachment:${imageId})\n![remote](https://evil.example/x.png)`;
    const r = await run(newRoute.action, services, post("/editor/new", editor.cookie, { ...FORM, bodyMarkdown: body, intent: "preview" }));
    expect(r.status).toBe(200);
    const d = r.data as { preview: { html: string }; values: Fields };
    expect(d.preview.html).toContain("<h1>Heading</h1>");
    expect(d.preview.html).not.toContain("<script");
    expect(d.preview.html).not.toMatch(/href="javascript:/i);
    expect(d.preview.html).not.toContain("evil.example");
    expect(d.preview.html).toContain(`<img src="/attachments/${imageId}" alt="Test chart"`);
    expect(d.preview.html).toBe(await services.publications.renderBody({ bodyMarkdown: body, attachmentIds: [imageId] }));
    expect(d.values.bodyMarkdown).toBe(body);
    expect(services.sqlite.prepare("select count(*) as n from publications").get()).toEqual({ n: 0 });
  });

  it("previews unsaved edits on an existing publication without a new revision", async () => {
    const { services, editor } = await setup();
    const id = await createViaForm(services, editor.cookie);
    const r = await edit(services, editor.cookie, id, { ...FORM, bodyMarkdown: "**Test preview**", expectedRevision: "1", intent: "preview" });
    expect((r.data as { preview: { html: string } }).preview.html).toContain("<strong>Test preview</strong>");
    expect((await services.publications.getForEditor({ kind: "member", userId: editor.userId, role: "editor" }, id))?.revision).toBe(1);
  });

  function uploadForm(bytes: Uint8Array, type: string, altText = "Test chart", name = "chart.png") {
    const form = new FormData();
    form.append("file", new File([bytes as BlobPart], name, { type }));
    form.append("altText", altText);
    return form;
  }

  it("uploads an image and returns the Markdown to use", async () => {
    const { services, editor, actor } = await setup();
    const r = await run(attachmentsRoute.action, services, await uploadPost(editor.cookie, uploadForm(PNG_BYTES, "image/png", "Test [chart]")));
    expect(r.status).toBe(200);
    const d = r.data as { ok: true; attachment: { id: string }; markdown: string };
    expect(d.markdown).toBe(`![Test \\[chart\\]](attachment:${d.attachment.id})`);
    expect((await services.attachments.status(actor, d.attachment.id)).ok).toBe(true);
    // The editor can now publish with it, and the public renderer shows it.
    const id = await createViaForm(services, editor.cookie, { bodyMarkdown: d.markdown }, "publish");
    const p = await services.publications.getPublic(id);
    expect(p?.attachmentIds).toEqual([d.attachment.id]);
    expect(await services.publications.renderBody(p!)).toContain(`src="/attachments/${d.attachment.id}" alt="Test [chart]"`);
  });

  it("trusts the file's bytes, not its name or declared type", async () => {
    const { services, editor } = await setup();
    const svg = await run(attachmentsRoute.action, services, await uploadPost(editor.cookie, uploadForm(SVG_BYTES, "image/png", "Test", "chart.png")));
    expect(svg.status).toBe(422);
    expect(svg.data).toMatchObject({ ok: false });
    const declaredSvg = await run(attachmentsRoute.action, services, await uploadPost(editor.cookie, uploadForm(SVG_BYTES, "image/svg+xml", "Test", "chart.svg")));
    expect(declaredSvg.status).toBe(422);
    expect(declaredSvg.data).toMatchObject({ message: "Only PNG, JPEG, and WebP images are accepted." });
    const noAlt = await run(attachmentsRoute.action, services, await uploadPost(editor.cookie, uploadForm(PNG_BYTES, "image/png", "  ")));
    expect(noAlt.status).toBe(422);
    const big = await run(attachmentsRoute.action, services, await uploadPost(editor.cookie, uploadForm(new Uint8Array(10 * 1024 * 1024 + 1), "image/png")));
    expect(big.status).toBe(413);
    const noLength = await run(attachmentsRoute.action, services, post("/editor/attachments", editor.cookie, uploadForm(PNG_BYTES, "image/png")));
    expect(noLength.status).toBe(411);
    expect(services.media.objects.size).toBe(0);
  });
});

describe("editor saves keep what the form cannot show", () => {
  it("keeps an agent's precise source time when the editor does not change the date", async () => {
    const { services, editor } = await setup();
    const agent = agentFor({ userId: editor.userId, role: "editor" });
    const created = await services.publications.create(agent, storyInput({ sourcePublishedAt: "2026-11-01T23:30:00-06:00" }));
    if (!created.ok) throw new Error(created.message);
    const id = created.value.publication.id;
    const page = await run(publicationRoute.loader as never, services, get(`/editor/publications/${id}`, editor.cookie), { id });
    const shown = (page.data as { values: Fields }).values;
    expect(shown.sourcePublishedAt).toBe("2026-11-02");

    await edit(services, editor.cookie, id, { ...shown, title: "Test title fixed by editor", sourcePublishedAtShown: shown.sourcePublishedAt!, expectedRevision: "1", intent: "save" });
    expect((await services.publications.getPublic(id))?.sourcePublishedAt?.toISOString()).toBe("2026-11-02T05:30:00.000Z");

    await edit(services, editor.cookie, id, { ...shown, sourcePublishedAt: "2026-10-30", sourcePublishedAtShown: shown.sourcePublishedAt!, expectedRevision: "2", intent: "save" });
    expect((await services.publications.getPublic(id))?.sourcePublishedAt?.toISOString()).toBe("2026-10-30T00:00:00.000Z");
  });

  it("shows attachment problems under the body field", async () => {
    const { services, editor } = await setup();
    const r = await run(newRoute.action, services, post("/editor/new", editor.cookie, { ...FORM, bodyMarkdown: "![x](attachment:not-a-real-upload)", intent: "save" }));
    expect(r.status).toBe(422);
    expect((r.data as { errors: Record<string, string[]> }).errors.bodyMarkdown?.[0]).toMatch(/not-a-real-upload/);
  });

  it("reloads page data after refused actions so stale pages refresh", () => {
    for (const route of [publicationRoute, historyRoute, homepageRoute]) {
      expect(route.shouldRevalidate({ actionStatus: 409, defaultShouldRevalidate: false } as never)).toBe(true);
    }
  });
});
