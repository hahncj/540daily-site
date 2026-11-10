// A11 (attachments) and the serving visibility check. Bytes are tiny signature-only test files.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENT_BYTES, sniffImageType } from "../../server/core/attachments";
import { attachments as attachmentsTable } from "../../server/db/schema";
import { agentFor, JPEG_BYTES, memberActor, PNG_BYTES, reportInput, storyInput, streamText, SVG_BYTES, testClock, uploadImage, WEBP_BYTES } from "../helpers/publishing";
import { createTestServices } from "../helpers/services";

describe("signature checks", () => {
  it("detects PNG, JPEG, and WebP from magic bytes only", () => {
    expect(sniffImageType(PNG_BYTES)).toBe("image/png");
    expect(sniffImageType(JPEG_BYTES)).toBe("image/jpeg");
    expect(sniffImageType(WEBP_BYTES)).toBe("image/webp");
    expect(sniffImageType(SVG_BYTES)).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("<html><script>x</script></html>"))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
  });
});

describe("A11: upload rules", () => {
  it("rejects disallowed types, oversize declarations, and missing alt text before issuing a ticket", async () => {
    const services = createTestServices();
    const editor = await memberActor(services, "editor@example.test");
    const svg = await services.attachments.prepareUpload(editor, { mimeType: "image/svg+xml", size: 100, altText: "x" });
    expect(!svg.ok && svg.status).toBe("invalid");
    const html = await services.attachments.prepareUpload(editor, { mimeType: "text/html", size: 100, altText: "x" });
    expect(!html.ok && html.status).toBe("invalid");
    const big = await services.attachments.prepareUpload(editor, { mimeType: "image/png", size: MAX_ATTACHMENT_BYTES + 1, altText: "x" });
    expect(!big.ok && big.status).toBe("too_large");
    const noAlt = await services.attachments.prepareUpload(editor, { mimeType: "image/png", size: 100, altText: "   " });
    expect(!noAlt.ok && noAlt.errors?.altText).toBeTruthy();
    const reader = await memberActor(services, "reader@example.test", "reader");
    expect((await services.attachments.prepareUpload(agentFor(reader), { mimeType: "image/png", size: 100, altText: "x" })).ok).toBe(false);
  });

  it("rejects bytes whose signature does not match, or that exceed the declared size", async () => {
    const services = createTestServices();
    const editor = await memberActor(services, "editor@example.test");
    const disguised = await services.attachments.prepareUpload(editor, { mimeType: "image/png", size: SVG_BYTES.byteLength, altText: "x" });
    if (!disguised.ok) throw new Error(disguised.message);
    const out = await services.attachments.completeUpload(disguised.value.token, SVG_BYTES);
    expect(!out.ok && out.status).toBe("invalid");
    expect((await services.attachments.status(editor, disguised.value.attachmentId)).ok && (await services.attachments.status(editor, disguised.value.attachmentId))).toMatchObject({
      value: { status: "rejected" },
    });
    expect(services.media.objects.size).toBe(0);

    const wrongType = await services.attachments.prepareUpload(editor, { mimeType: "image/png", size: JPEG_BYTES.byteLength, altText: "x" });
    if (!wrongType.ok) throw new Error(wrongType.message);
    expect((await services.attachments.completeUpload(wrongType.value.token, JPEG_BYTES)).ok).toBe(false);

    const small = await services.attachments.prepareUpload(editor, { mimeType: "image/png", size: 8, altText: "x" });
    if (!small.ok) throw new Error(small.message);
    const over = await services.attachments.completeUpload(small.value.token, PNG_BYTES);
    expect(!over.ok && over.status).toBe("too_large");
  });

  it("uses tickets once, refuses expired tickets, and lets a storage failure be retried", async () => {
    const clock = testClock();
    const services = createTestServices({ now: clock.now });
    const editor = await memberActor(services, "editor@example.test");
    const t = await services.attachments.prepareUpload(editor, { mimeType: "image/png", size: PNG_BYTES.byteLength, altText: "x" });
    if (!t.ok) throw new Error(t.message);

    services.media.failing = true;
    const failed = await services.attachments.completeUpload(t.value.token, PNG_BYTES);
    expect(!failed.ok && failed.status).toBe("unavailable");
    services.media.failing = false;
    const done = await services.attachments.completeUpload(t.value.token, PNG_BYTES);
    expect(done.ok && done.value.status).toBe("ready");
    const reuse = await services.attachments.completeUpload(t.value.token, PNG_BYTES);
    expect(!reuse.ok && reuse.status).toBe("not_found");
    const [row] = await services.db.select().from(attachmentsTable).where(eq(attachmentsTable.id, t.value.attachmentId));
    expect(row).toMatchObject({ status: "ready", size: PNG_BYTES.byteLength, mimeType: "image/png" });
    expect(row!.sha256).toMatch(/^[0-9a-f]{64}$/);

    const late = await services.attachments.prepareUpload(editor, { mimeType: "image/png", size: PNG_BYTES.byteLength, altText: "x" });
    if (!late.ok) throw new Error(late.message);
    clock.advance(16 * 60 * 1000);
    expect((await services.attachments.completeUpload(late.value.token, PNG_BYTES)).ok).toBe(false);
    expect((await services.attachments.completeUpload("not-a-token", PNG_BYTES)).ok).toBe(false);
  });

  it("lets agents use only their own member's uploads", async () => {
    const services = createTestServices();
    const a = await memberActor(services, "a@example.test");
    const b = await memberActor(services, "b@example.test");
    const bAsset = await uploadImage(services, agentFor(b));
    const out = await services.publications.create(agentFor(a), reportInput({ bodyMarkdown: `![Chart](attachment:${bAsset})` }));
    expect(!out.ok && out.errors?.attachmentIds).toBeTruthy();
    expect((await services.attachments.status(agentFor(a), bAsset)).ok).toBe(false);

    const pending = await services.attachments.prepareUpload(agentFor(a), { mimeType: "image/png", size: 16, altText: "x" });
    if (!pending.ok) throw new Error(pending.message);
    const notReady = await services.publications.create(agentFor(a), storyInput({ attachmentIds: [pending.value.attachmentId] }));
    expect(!notReady.ok && notReady.status).toBe("invalid");

    const own = await uploadImage(services, agentFor(a));
    const ok = await services.publications.create(agentFor(a), reportInput({ bodyMarkdown: `![Chart](attachment:${own})` }));
    expect(ok.ok && ok.value.publication.attachmentIds).toEqual([own]);
  });

  it("lets an editor keep another member's assets on a publication they edit, but not add new ones", async () => {
    const services = createTestServices();
    const author = await memberActor(services, "author@example.test");
    const editor = await memberActor(services, "editor@example.test");
    const asset = await uploadImage(services, agentFor(author));
    const other = await uploadImage(services, agentFor(author));
    const created = await services.publications.create(agentFor(author), reportInput({ bodyMarkdown: `![Chart](attachment:${asset})` }));
    if (!created.ok) throw new Error(created.message);
    const keep = await services.publications.update(editor, created.value.publication.id, { expectedRevision: 1, title: "Edited (test)" });
    expect(keep.ok).toBe(true);
    const add = await services.publications.update(editor, created.value.publication.id, { expectedRevision: 2, attachmentIds: [asset, other] });
    expect(!add.ok && add.status).toBe("invalid");
  });
});

describe("assets added by another member", () => {
  it("lets an agent keep an image an editor added to its member's publication", async () => {
    const services = createTestServices();
    const author = await memberActor(services, "author@example.test");
    const editor = await memberActor(services, "editor@example.test");
    const agent = agentFor(author);
    const created = await services.publications.create(agent, reportInput());
    if (!created.ok) throw new Error(created.message);
    const id = created.value.publication.id;
    const editorAsset = await uploadImage(services, editor);
    const added = await services.publications.update(editor, id, { expectedRevision: 1, bodyMarkdown: `![Chart](attachment:${editorAsset})` });
    expect(added.ok).toBe(true);
    const byAgent = await services.publications.update(agent, id, { expectedRevision: 2, title: "Agent retitle (test)" });
    expect(byAgent.ok && byAgent.value.attachmentIds).toEqual([editorAsset]);
    // But the agent still cannot attach the editor's other uploads.
    const other = await uploadImage(services, editor);
    const steal = await services.publications.update(agent, id, { expectedRevision: 3, attachmentIds: [other] });
    expect(!steal.ok && steal.status).toBe("invalid");
  });

  it("does not treat mentions of the syntax in code as attachments", async () => {
    const services = createTestServices();
    const agent = agentFor(await memberActor(services, "editor@example.test"));
    const out = await services.publications.create(agent, reportInput({ bodyMarkdown: "Reference images with `![alt](attachment:ID)` (test data)." }));
    expect(out.ok && out.value.publication.attachmentIds).toEqual([]);
  });
});

describe("serving visibility", () => {
  async function setup() {
    const services = createTestServices();
    const editor = await memberActor(services, "editor@example.test");
    const author = await memberActor(services, "author@example.test");
    const agent = agentFor(author);
    const assetV1 = await uploadImage(services, agent, PNG_BYTES, "image/png", "First chart");
    const assetV2 = await uploadImage(services, agent, WEBP_BYTES, "image/webp", "Second chart");
    const created = await services.publications.create(agent, reportInput({ bodyMarkdown: `![v1](attachment:${assetV1})` }));
    if (!created.ok) throw new Error(created.message);
    const id = created.value.publication.id;
    const viewer = (m: { userId: string; role: "reader" | "editor" | "owner" }) => ({ userId: m.userId, role: m.role, status: "active" as const });
    return { services, editor, author, agent, assetV1, assetV2, id, viewer };
  }

  it("serves assets of current published versions publicly with a short cache", async () => {
    const { services, assetV1 } = await setup();
    const out = await services.attachments.open(null, assetV1);
    expect(out).toMatchObject({ visibility: "public", contentType: "image/png", cacheControl: "public, max-age=300" });
    expect(await streamText(out!.body)).toEqual(PNG_BYTES);
  });

  it("A11: keeps assets of historical revisions for editors only, and restore brings them back", async () => {
    const { services, editor, author, agent, assetV1, assetV2, id, viewer } = await setup();
    const v2 = await services.publications.update(agent, id, { expectedRevision: 1, bodyMarkdown: `![v2](attachment:${assetV2})` });
    expect(v2.ok).toBe(true);
    expect(await services.attachments.open(null, assetV1)).toBeNull();
    expect((await services.attachments.open(viewer(editor), assetV1))?.cacheControl).toBe("private, no-store");
    expect((await services.attachments.open(viewer(author), assetV1))?.visibility).toBe("private");
    const someone = await memberActor(services, "reader@example.test", "reader");
    expect(await services.attachments.open(viewer(someone), assetV1)).toBeNull();
    expect(await services.attachments.open(null, assetV2)).not.toBeNull();
    // The old revision still renders its asset in the editor's history view.
    const r1 = await services.publications.getRevision(editor, id, 1);
    if (!r1.ok) throw new Error(r1.message);
    expect(await services.publications.renderBody(r1.value.content)).toContain(`/attachments/${assetV1}`);

    const restored = await services.publications.restoreRevision(editor, id, 1, 2);
    expect(restored.ok && restored.value.attachmentIds).toEqual([assetV1]);
    expect((await services.attachments.open(null, assetV1))?.visibility).toBe("public");
    expect(await services.attachments.open(null, assetV2)).toBeNull();
  });

  it("A8 (core): unpublishing blocks public access to its assets", async () => {
    const { services, editor, assetV1, id, viewer } = await setup();
    await services.publications.unpublish(editor, id, 1);
    expect(await services.attachments.open(null, assetV1)).toBeNull();
    expect((await services.attachments.open(viewer(editor), assetV1))?.visibility).toBe("private");
    await services.publications.restoreVisibility(editor, id, 2);
    expect((await services.attachments.open(null, assetV1))?.visibility).toBe("public");
  });

  it("does not serve unreferenced, unknown, or malformed IDs to the public", async () => {
    const { services, agent } = await setup();
    const loose = await uploadImage(services, agent);
    expect(await services.attachments.open(null, loose)).toBeNull();
    expect(await services.attachments.open(null, "missing")).toBeNull();
    expect(await services.attachments.open(null, "../../etc/passwd")).toBeNull();
  });

  it("renders only the publication's own attachments in the body", async () => {
    const { services, agent, assetV1, assetV2, id } = await setup();
    const p = await services.publications.getForAgent(agent, id);
    const html = await services.publications.renderBody({ bodyMarkdown: `![a](attachment:${assetV1}) ![b](attachment:${assetV2})`, attachmentIds: p!.attachmentIds });
    expect(html).toContain(`/attachments/${assetV1}`);
    expect(html).not.toContain(`/attachments/${assetV2}`);
  });
});

describe("owner cleanup of unreferenced uploads", () => {
  it("deletes only unreferenced uploads older than seven days, and only for the owner", async () => {
    const clock = testClock();
    const services = createTestServices({ now: clock.now });
    const editor = await memberActor(services, "editor@example.test");
    const owner = { userId: (await memberActor(services, "owner2@example.test", "owner")).userId, role: "owner" as const, status: "active" as const };
    const used = await uploadImage(services, editor);
    const unused = await uploadImage(services, editor);
    await services.publications.create(editor, reportInput({ bodyMarkdown: `![x](attachment:${used})` }));
    clock.advance(6 * 24 * 3600 * 1000);
    const fresh = await uploadImage(services, editor);
    clock.advance(2 * 24 * 3600 * 1000);

    expect((await services.attachments.cleanupUnreferenced({ userId: editor.userId, role: "editor", status: "active" })).ok).toBe(false);
    const out = await services.attachments.cleanupUnreferenced(owner);
    expect(out.ok && out.value.deleted).toBe(1);
    const left = (await services.db.select({ id: attachmentsTable.id }).from(attachmentsTable)).map((r) => r.id).sort();
    expect(left).toEqual([used, fresh].sort());
    expect(services.media.objects.has(`attachments/${unused}`)).toBe(false);
    expect(services.media.objects.has(`attachments/${used}`)).toBe(true);
  });
});
