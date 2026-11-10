// Lane 2A acceptance tests: MCP and the HTTP API over the shared publishing core.
// Local only: in-memory SQLite with the real migrations, in-process Better Auth OAuth, memory media store.
// All identities and publications are test data.
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../server/db/schema";
import { api, authorize, callTool, connectAgent, createKeyFor, mcpRequest, mcpResult, memberWithKey, registerClient, signedInMember } from "../helpers/agents";
import { memberActor, PNG_BYTES, reportInput, storyInput, SVG_BYTES } from "../helpers/publishing";
import { BASE_URL, createTestServices, request, type TestServices } from "../helpers/services";

afterEach(() => vi.restoreAllMocks());

async function publicationCount(services: TestServices) {
  return (await services.db.select({ id: schema.publications.id }).from(schema.publications)).length;
}

/** Wait until the wall clock moves into the next second (JWT `iat` has one-second resolution). */
async function nextSecond() {
  await new Promise((resolve) => setTimeout(resolve, 1100 - (Date.now() % 1000)));
}

describe("A4: each interface creates and reads back a publication", () => {
  it("MCP create, then read back over MCP and HTTP with identical shapes", async () => {
    const services = createTestServices();
    const { key } = await memberWithKey(services, "editor-a4@example.test", "editor");

    const created = await callTool(services, key, "create_publication", storyInput({ externalId: "a4-mcp-1", category: "Quantum Computing" }));
    expect(created.isError).toBe(false);
    expect(created.body.status).toBe("created");
    const publication = created.body.publication as Record<string, unknown> & { id: string; revision: number; url: string };
    expect(publication.revision).toBe(1);
    expect(publication.status).toBe("published");
    expect(publication.url).toMatch(new RegExp(`^${BASE_URL}/publications/${publication.id}/`));
    expect(publication.createdBy).toMatchObject({ kind: "agent", label: "Test agent key", isYou: true });

    const viaMcp = await callTool(services, key, "get_publication", { id: publication.id });
    const viaHttp = await api(services, key, "GET", `/api/v1/publications/${publication.id}`);
    expect(viaHttp.status).toBe(200);
    expect(viaHttp.headers.get("cache-control")).toBe("no-store");
    expect(viaMcp.body).toEqual(viaHttp.body);
    expect(viaHttp.body.publication).toEqual(publication);
  });

  it("HTTP create of a report, then read back over HTTP and MCP", async () => {
    const services = createTestServices();
    const { key } = await memberWithKey(services, "editor-a4h@example.test", "editor");

    const created = await api(services, key, "POST", "/api/v1/publications", reportInput({ externalId: "a4-http-1", tags: ["briefing"] }));
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("created");
    const id = (created.body.publication as { id: string }).id;

    const viaHttp = await api(services, key, "GET", `/api/v1/publications/${id}`);
    const viaMcp = await callTool(services, key, "get_publication", { id });
    expect(viaHttp.body).toEqual(viaMcp.body);
    expect(viaHttp.body.publication).toMatchObject({ type: "report", tags: ["briefing"], bodyMarkdown: expect.stringContaining("Overview") });

    const searchHttp = await api(services, key, "GET", "/api/v1/publications?q=report&type=report");
    const searchMcp = await callTool(services, key, "search_publications", { q: "report", type: "report" });
    expect(searchHttp.status).toBe(200);
    expect(searchHttp.body).toEqual(searchMcp.body);
    expect(searchHttp.body.items).toEqual([expect.objectContaining({ id })]);
  });

  it("a new category is persisted but stays off the public homepage until an editor selects it", async () => {
    const services = createTestServices();
    const { key } = await memberWithKey(services, "editor-a4c@example.test", "editor");
    await api(services, key, "POST", "/api/v1/publications", storyInput({ category: "Space Weather" }));

    const categories = await api(services, key, "GET", "/api/v1/categories");
    const viaMcp = await callTool(services, key, "list_categories");
    expect(categories.body).toEqual(viaMcp.body);
    expect(categories.body.categories).toContainEqual(expect.objectContaining({ name: "Space Weather", slug: "space-weather" }));
    const layout = await services.homepage.layout();
    expect(layout.map((c) => c.name)).not.toContain("Space Weather");
  });
});

describe("A5: duplicate and concurrent creates across MCP and HTTP", () => {
  it("the same payload over MCP then HTTP produces one publication", async () => {
    const services = createTestServices();
    const { key } = await memberWithKey(services, "editor-a5@example.test", "editor");
    const payload = storyInput({ externalId: "a5-cross-1" });

    const first = await callTool(services, key, "create_publication", payload);
    const second = await api(services, key, "POST", "/api/v1/publications", payload);
    expect(first.body.status).toBe("created");
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("replayed");
    expect((second.body.publication as { id: string }).id).toBe((first.body.publication as { id: string }).id);
    expect(await publicationCount(services)).toBe(1);
  });

  it("concurrent identical creates over both interfaces produce one publication", async () => {
    const services = createTestServices();
    const { key } = await memberWithKey(services, "editor-a5c@example.test", "editor");
    const payload = storyInput({ externalId: "a5-concurrent-1" });

    const results = await Promise.all([
      callTool(services, key, "create_publication", payload).then((r) => ({ status: r.body.status, id: (r.body.publication as { id: string }).id })),
      api(services, key, "POST", "/api/v1/publications", payload).then((r) => ({ status: r.body.status, id: (r.body.publication as { id: string }).id })),
      callTool(services, key, "create_publication", payload).then((r) => ({ status: r.body.status, id: (r.body.publication as { id: string }).id })),
      api(services, key, "POST", "/api/v1/publications", payload).then((r) => ({ status: r.body.status, id: (r.body.publication as { id: string }).id })),
    ]);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => r.status === "created")).toHaveLength(1);
    expect(results.filter((r) => r.status === "replayed")).toHaveLength(3);
    expect(await publicationCount(services)).toBe(1);
  });

  it("replays across the member's different credentials (API key, then OAuth connection)", async () => {
    const services = createTestServices();
    const member = await signedInMember(services, "editor-a5k@example.test", "editor");
    const key = await createKeyFor(services, member.userId);
    const { accessToken } = await connectAgent(services, member);
    const payload = storyInput({ externalId: "a5-credentials-1" });

    const viaKey = await api(services, key, "POST", "/api/v1/publications", payload);
    const viaOauth = await callTool(services, accessToken, "create_publication", payload);
    expect(viaOauth.body.status).toBe("replayed");
    expect((viaOauth.body.publication as { id: string }).id).toBe((viaKey.body.publication as { id: string }).id);
  });

  it("a changed payload under the same externalId returns a conflict on both interfaces", async () => {
    const services = createTestServices();
    const { key } = await memberWithKey(services, "editor-a5x@example.test", "editor");
    const payload = storyInput({ externalId: "a5-conflict-1" });
    await api(services, key, "POST", "/api/v1/publications", payload);

    const changed = { ...payload, title: "A different title (test data)" };
    const viaHttp = await api(services, key, "POST", "/api/v1/publications", changed);
    const viaMcp = await callTool(services, key, "create_publication", changed);
    expect(viaHttp.status).toBe(409);
    expect(viaHttp.body.status).toBe("conflict");
    expect(viaMcp.isError).toBe(true);
    expect(viaMcp.body).toEqual(viaHttp.body);
    expect(await publicationCount(services)).toBe(1);
  });
});

describe("A6: agents act as their member, with guardrails and revocation", () => {
  it("an agent acting as member A cannot update member B's content", async () => {
    const services = createTestServices();
    const a = await memberWithKey(services, "editor-a6a@example.test", "editor");
    const b = await memberWithKey(services, "editor-a6b@example.test", "editor");
    const bItem = (await api(services, b.key, "POST", "/api/v1/publications", storyInput())).body.publication as { id: string; revision: number };

    const viaHttp = await api(services, a.key, "PATCH", `/api/v1/publications/${bItem.id}`, { expectedRevision: bItem.revision, title: "Hijacked (test data)" });
    const viaMcp = await callTool(services, a.key, "update_publication", { id: bItem.id, expectedRevision: bItem.revision, title: "Hijacked (test data)" });
    expect(viaHttp.status).toBe(403);
    expect(viaHttp.body.status).toBe("forbidden");
    expect(viaMcp.isError).toBe(true);
    expect(viaMcp.body).toEqual(viaHttp.body);
    expect((await services.publications.getPublic(bItem.id))?.title).not.toContain("Hijacked");
  });

  it("another member's unpublished item looks missing to an agent", async () => {
    const services = createTestServices();
    const a = await memberWithKey(services, "editor-a6p@example.test", "editor");
    const b = await memberWithKey(services, "editor-a6q@example.test", "editor");
    const item = (await api(services, b.key, "POST", "/api/v1/publications", storyInput())).body.publication as { id: string; revision: number };
    const editor = await memberActor(services, "desk-a6@example.test", "editor");
    expect((await services.publications.unpublish(editor, item.id, item.revision)).ok).toBe(true);

    expect((await api(services, a.key, "GET", `/api/v1/publications/${item.id}`)).status).toBe(404);
    expect((await api(services, a.key, "PATCH", `/api/v1/publications/${item.id}`, { expectedRevision: 2, title: "x" })).status).toBe(404);
    // The creator's own agent can still read it, for correction.
    expect((await api(services, b.key, "GET", `/api/v1/publications/${item.id}`)).body.publication).toMatchObject({ status: "unpublished" });
  });

  it("A's new key and A's reconnected client can still update A's items", async () => {
    const services = createTestServices();
    const member = await signedInMember(services, "editor-a6n@example.test", "editor");
    const oldKey = await createKeyFor(services, member.userId, "editor", "Old key");
    const item = (await api(services, oldKey, "POST", "/api/v1/publications", storyInput())).body.publication as { id: string; revision: number };

    // Rotate: revoke the old key, create a new one.
    const [oldRow] = await services.db.select().from(schema.apiKeys).where(eq(schema.apiKeys.userId, member.userId));
    expect((await services.apiKeys.revoke({ userId: member.userId, role: "editor", status: "active" }, oldRow!.id)).ok).toBe(true);
    const newKey = await createKeyFor(services, member.userId, "editor", "New key");
    const viaNewKey = await api(services, newKey, "PATCH", `/api/v1/publications/${item.id}`, { expectedRevision: 1, title: "Updated by new key (test data)" });
    expect(viaNewKey.status).toBe(200);
    expect(viaNewKey.body.publication).toMatchObject({ revision: 2, title: "Updated by new key (test data)" });

    // Connect, disconnect, reconnect the same MCP client.
    const first = await connectAgent(services, member, { clientName: "Reconnecting client" });
    expect((await services.agents.disconnect({ userId: member.userId, role: "editor", status: "active" }, { userId: member.userId, clientId: first.clientId })).ok).toBe(true);
    await nextSecond();
    const again = await connectAgent(services, member, { clientId: first.clientId });
    const viaClient = await callTool(services, again.accessToken, "update_publication", { id: item.id, expectedRevision: 2, summary: "Updated by reconnected client (test data)." });
    expect(viaClient.isError).toBe(false);
    expect(viaClient.body.publication).toMatchObject({ revision: 3 });
  });

  it("revoked keys and disconnected clients fail with 401 on the next call", async () => {
    const services = createTestServices();
    const member = await signedInMember(services, "editor-a6r@example.test", "editor");
    const viewer = { userId: member.userId, role: "editor" as const, status: "active" as const };
    const key = await createKeyFor(services, member.userId);
    const { accessToken, clientId } = await connectAgent(services, member);
    expect((await api(services, key, "GET", "/api/v1/categories")).status).toBe(200);
    expect((await api(services, accessToken, "GET", "/api/v1/categories")).status).toBe(200);

    const [row] = await services.db.select().from(schema.apiKeys).where(eq(schema.apiKeys.userId, member.userId));
    await services.apiKeys.revoke(viewer, row!.id);
    const revoked = await api(services, key, "GET", "/api/v1/categories");
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get("www-authenticate")).toBe('Bearer realm="540daily"');
    expect((await mcpRequest(services, key, "tools/list")).status).toBe(401);

    await services.agents.disconnect(viewer, { userId: member.userId, clientId });
    expect((await api(services, accessToken, "GET", "/api/v1/categories")).status).toBe(401);
    const mcp = await mcpRequest(services, accessToken, "tools/list");
    expect(mcp.status).toBe(401);
    expect(mcp.headers.get("www-authenticate")).toContain('error="invalid_token"');
    // Refresh tokens are revoked too.
    const refreshRows = await services.db.select().from(schema.oauthRefreshToken).where(eq(schema.oauthRefreshToken.clientId, clientId));
    expect(refreshRows.every((r) => r.revoked !== null)).toBe(true);
  });

  it("agents acting as readers cannot write, but can read", async () => {
    const services = createTestServices();
    const reader = await signedInMember(services, "reader-a6@example.test", "reader");
    const { accessToken } = await connectAgent(services, reader);

    const create = await callTool(services, accessToken, "create_publication", storyInput());
    expect(create).toMatchObject({ isError: true, body: { status: "forbidden" } });
    const upload = await api(services, accessToken, "POST", "/api/v1/attachment-uploads", { mimeType: "image/png", size: 100, altText: "Chart" });
    expect(upload.status).toBe(403);
    expect((await api(services, accessToken, "GET", "/api/v1/publications")).status).toBe(200);
  });

  it("disabled and demoted members' agents cannot write", async () => {
    const services = createTestServices();
    const demoted = await memberWithKey(services, "editor-a6d@example.test", "editor");
    const disabled = await memberWithKey(services, "editor-a6x@example.test", "editor");
    expect((await api(services, demoted.key, "POST", "/api/v1/publications", storyInput())).status).toBe(201);

    await services.db.update(schema.memberships).set({ role: "reader" }).where(eq(schema.memberships.userId, demoted.userId));
    const afterDemotion = await api(services, demoted.key, "POST", "/api/v1/publications", storyInput());
    expect(afterDemotion.status).toBe(403);

    await services.db.update(schema.memberships).set({ status: "disabled" }).where(eq(schema.memberships.userId, disabled.userId));
    expect((await api(services, disabled.key, "POST", "/api/v1/publications", storyInput())).status).toBe(401);
    expect((await mcpRequest(services, disabled.key, "tools/list")).status).toBe(401);
  });

  it("an agent update cannot republish an item an editor unpublished", async () => {
    const services = createTestServices();
    const { key } = await memberWithKey(services, "editor-a6u@example.test", "editor");
    const item = (await api(services, key, "POST", "/api/v1/publications", storyInput())).body.publication as { id: string };
    const editor = await memberActor(services, "desk-a6u@example.test", "editor");
    await services.publications.unpublish(editor, item.id, 1);

    const updated = await api(services, key, "PATCH", `/api/v1/publications/${item.id}`, { expectedRevision: 2, title: "Fixed title (test data)" });
    expect(updated.status).toBe(200);
    expect(updated.body.publication).toMatchObject({ status: "unpublished", revision: 3 });
    expect(await services.publications.getPublic(item.id)).toBeNull();
  });

  it("agents have no unpublish, restore, delete, layout, or access operations", async () => {
    const services = createTestServices();
    const { key } = await memberWithKey(services, "editor-a6t@example.test", "editor");
    const { tools } = (await mcpResult(services, key, "tools/list")) as { tools: Array<{ name: string }> };
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["create_publication", "get_publication", "list_categories", "prepare_attachment_upload", "search_publications", "update_publication"].sort(),
    );
    expect((await api(services, key, "DELETE", "/api/v1/publications/x")).status).toBe(405);
    expect((await api(services, key, "POST", "/api/v1/publications/x/unpublish")).status).toBe(404);
  });
});

describe("A13: MCP discovery, OAuth, initialization, tools, and documented failures", () => {
  it("unauthenticated /mcp gets the RFC 9728 challenge", async () => {
    const services = createTestServices();
    const response = await request(services, "/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource/mcp"`);
    expect(await response.json()).toEqual({ jsonrpc: "2.0", error: { code: -32001, message: "Authentication required" }, id: null });

    const invalid = await mcpRequest(services, "not-a-real-token", "tools/list");
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="The access token is invalid, expired, or revoked"`,
    );
  });

  it("serves OAuth discovery for the MCP resource", async () => {
    const services = createTestServices();
    const resource = await (await request(services, "/.well-known/oauth-protected-resource/mcp")).json();
    expect(resource).toMatchObject({ resource: `${BASE_URL}/mcp`, authorization_servers: [`${BASE_URL}/api/auth`] });
    const server = await (await request(services, "/.well-known/oauth-authorization-server/api/auth")).json();
    expect(server).toMatchObject({
      issuer: `${BASE_URL}/api/auth`,
      registration_endpoint: expect.stringContaining("/api/auth/oauth2/register"),
      code_challenge_methods_supported: ["S256"],
      client_id_metadata_document_supported: true,
    });
  });

  it("OAuth consent and token flow, then initialize, list tools, and call a tool", async () => {
    const services = createTestServices();
    const member = await signedInMember(services, "editor-a13@example.test", "editor");
    const clientId = await registerClient(services, "Flow test client");
    const started = await authorize(services, member.cookie, clientId);
    expect(started.status).toBe(302);
    expect(started.location.startsWith("/consent?")).toBe(true);

    const { accessToken } = await connectAgent(services, member, { clientId });
    const init = await mcpResult(services, accessToken, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.0" },
    });
    expect(init.serverInfo).toMatchObject({ name: "540-daily" });
    expect(String(init.instructions)).toContain("externalId");

    const { tools } = (await mcpResult(services, accessToken, "tools/list")) as {
      tools: Array<{ name: string; annotations: { readOnlyHint: boolean }; inputSchema: { properties: Record<string, unknown> } }>;
    };
    const hints = Object.fromEntries(tools.map((t) => [t.name, t.annotations.readOnlyHint]));
    expect(hints).toEqual({
      list_categories: true,
      search_publications: true,
      get_publication: true,
      create_publication: false,
      update_publication: false,
      prepare_attachment_upload: false,
    });
    expect(Object.keys(tools.find((t) => t.name === "create_publication")!.inputSchema.properties)).toEqual(
      expect.arrayContaining(["externalId", "type", "title", "summary", "bodyMarkdown", "category", "tags", "sources", "attachmentIds"]),
    );

    const created = await callTool(services, accessToken, "create_publication", storyInput());
    expect(created.body.publication).toMatchObject({ createdBy: { kind: "agent", label: "Flow test client", attribution: "Test editor via Flow test client" } });
  });

  it("a token issued without the MCP resource is refused", async () => {
    const services = createTestServices();
    const member = await signedInMember(services, "editor-a13r@example.test", "editor");
    // Without `resource`, the provider issues an opaque token, not a JWT for the MCP audience.
    const { accessToken } = await connectAgent(services, member, { resource: null });
    expect((await mcpRequest(services, accessToken, "tools/list")).status).toBe(401);
    expect((await api(services, accessToken, "GET", "/api/v1/categories")).status).toBe(401);
  });

  it("legacy GET and DELETE session calls get 405", async () => {
    const services = createTestServices();
    const { key } = await memberWithKey(services, "editor-a13g@example.test", "editor");
    for (const method of ["GET", "DELETE"]) {
      const response = await request(services, "/mcp", { method, headers: { Authorization: `Bearer ${key}`, Accept: "text/event-stream" } });
      expect(response.status).toBe(405);
    }
  });

  it("both interfaces share validation and return the same structured errors", async () => {
    const services = createTestServices();
    const { key } = await memberWithKey(services, "editor-a13v@example.test", "editor");
    const bad = { externalId: "a13-bad", type: "report", title: "", summary: "s", category: "Tech", sources: [{ url: "javascript:alert(1)" }] };

    const viaHttp = await api(services, key, "POST", "/api/v1/publications", bad);
    const viaMcp = await callTool(services, key, "create_publication", bad);
    expect(viaHttp.status).toBe(422);
    expect(viaHttp.body.status).toBe("validation_failed");
    expect(viaHttp.body.errors).toMatchObject({ title: expect.any(Array), "sources.0.url": expect.any(Array) });
    expect(viaMcp.isError).toBe(true);
    expect(viaMcp.body).toEqual(viaHttp.body);

    const badSearchHttp = await api(services, key, "GET", "/api/v1/publications?from=yesterday");
    const badSearchMcp = await callTool(services, key, "search_publications", { from: "yesterday" });
    expect(badSearchHttp.status).toBe(422);
    expect(badSearchMcp.body).toEqual(badSearchHttp.body);
  });

  it("stale revisions return a conflict with the current revision on both interfaces", async () => {
    const services = createTestServices();
    const { key } = await memberWithKey(services, "editor-a13s@example.test", "editor");
    const item = (await api(services, key, "POST", "/api/v1/publications", storyInput())).body.publication as { id: string };
    await api(services, key, "PATCH", `/api/v1/publications/${item.id}`, { expectedRevision: 1, title: "Second (test data)" });

    const viaHttp = await api(services, key, "PATCH", `/api/v1/publications/${item.id}`, { expectedRevision: 1, title: "Stale (test data)" });
    const viaMcp = await callTool(services, key, "update_publication", { id: item.id, expectedRevision: 1, title: "Stale (test data)" });
    expect(viaHttp.status).toBe(409);
    expect(viaHttp.body).toMatchObject({ status: "conflict", currentRevision: 2 });
    expect(viaMcp.body).toEqual(viaHttp.body);
  });

  it("HTTP API returns the documented status codes for malformed, missing, oversized, and unknown requests", async () => {
    const services = createTestServices();
    const { key } = await memberWithKey(services, "editor-a13h@example.test", "editor");

    const missing = await api(services, null, "GET", "/api/v1/categories");
    expect(missing.status).toBe(401);
    expect(missing.body.status).toBe("unauthorized");
    expect((await api(services, key, "POST", "/api/v1/publications", "{not json")).status).toBe(400);
    expect((await api(services, key, "POST", "/api/v1/publications", "[1,2]")).status).toBe(400);
    const huge = JSON.stringify(storyInput({ bodyMarkdown: "x".repeat(300 * 1024) }));
    expect((await api(services, key, "POST", "/api/v1/publications", huge)).status).toBe(413);
    const hugeMcp = await request(services, "/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_publication", arguments: JSON.parse(huge) } }),
    });
    expect(hugeMcp.status).toBe(413);
    expect((await api(services, key, "GET", "/api/v1/nothing-here")).status).toBe(404);
    expect((await api(services, key, "GET", "/api/v1/publications/does-not-exist")).status).toBe(404);
    const wrongMethod = await api(services, key, "PUT", "/api/v1/publications");
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("GET, POST");
  });

  it("a PATCH that resends externalId is accepted (the field is ignored)", async () => {
    const services = createTestServices();
    const { key } = await memberWithKey(services, "editor-a13p@example.test", "editor");
    const payload = storyInput({ externalId: "a13-patch-ext" });
    const item = (await api(services, key, "POST", "/api/v1/publications", payload)).body.publication as { id: string };

    const viaHttp = await api(services, key, "PATCH", `/api/v1/publications/${item.id}`, { ...payload, expectedRevision: 1, title: "Edited (test data)" });
    expect(viaHttp.status).toBe(200);
    expect(viaHttp.body.status).toBe("updated");
    const viaMcp = await callTool(services, key, "update_publication", { ...payload, id: item.id, expectedRevision: 2, title: "Edited again (test data)" });
    expect(viaMcp.body).toMatchObject({ status: "updated", publication: { revision: 3 } });
  });
});

describe("Attachment upload ticket flow", () => {
  it("prepare over HTTP, PUT the bytes, check status, and publish with the image", async () => {
    const services = createTestServices();
    const { key } = await memberWithKey(services, "editor-up@example.test", "editor");

    const ticket = await api(services, key, "POST", "/api/v1/attachment-uploads", { mimeType: "image/png", size: PNG_BYTES.byteLength, altText: "Test chart" });
    expect(ticket.status).toBe(201);
    const { attachmentId, uploadUrl, markdown } = ticket.body as unknown as { attachmentId: string; uploadUrl: string; markdown: string };
    expect(uploadUrl.startsWith(`${BASE_URL}/api/v1/uploads/`)).toBe(true);
    expect(markdown).toBe(`![Test chart](attachment:${attachmentId})`);

    const pending = await api(services, key, "GET", `/api/v1/attachments/${attachmentId}`);
    expect(pending.body.attachment).toMatchObject({ status: "pending" });

    const put = await request(services, uploadUrl.slice(BASE_URL.length), { method: "PUT", body: PNG_BYTES, headers: { "Content-Type": "image/png" } });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { attachment: unknown }).attachment).toMatchObject({ id: attachmentId, status: "ready" });
    // Single use.
    expect((await request(services, uploadUrl.slice(BASE_URL.length), { method: "PUT", body: PNG_BYTES })).status).toBe(404);

    const ready = await api(services, key, "GET", `/api/v1/attachments/${attachmentId}`);
    expect(ready.body.attachment).toMatchObject({ status: "ready" });

    const created = await api(services, key, "POST", "/api/v1/publications", reportInput({ bodyMarkdown: `## Chart\n\n${markdown}` }));
    expect(created.status).toBe(201);
    expect(created.body.publication).toMatchObject({ attachmentIds: [attachmentId] });
  });

  it("prepare over MCP; wrong file types and oversized bodies are rejected; status is private to the uploader", async () => {
    const services = createTestServices();
    const { key } = await memberWithKey(services, "editor-up2@example.test", "editor");
    const other = await memberWithKey(services, "editor-up3@example.test", "editor");

    const svg = await callTool(services, key, "prepare_attachment_upload", { mimeType: "image/png", size: SVG_BYTES.byteLength, altText: "Not really a PNG" });
    expect(svg.body.status).toBe("created");
    const svgPath = String(svg.body.uploadUrl).slice(BASE_URL.length);
    const rejected = await request(services, svgPath, { method: "PUT", body: SVG_BYTES });
    expect(rejected.status).toBe(422);
    expect(((await rejected.json()) as { status: string }).status).toBe("validation_failed");

    const big = await api(services, key, "POST", "/api/v1/attachment-uploads", { mimeType: "image/png", size: 11 * 1024 * 1024, altText: "Too big" });
    expect(big.status).toBe(413);
    const noAlt = await callTool(services, key, "prepare_attachment_upload", { mimeType: "image/png", size: 100, altText: "" });
    expect(noAlt.body.status).toBe("validation_failed");

    const small = await api(services, key, "POST", "/api/v1/attachment-uploads", { mimeType: "image/png", size: PNG_BYTES.byteLength, altText: "Chart" });
    const oversized = new Uint8Array(PNG_BYTES.byteLength + 10);
    oversized.set(PNG_BYTES);
    const tooLarge = await request(services, String(small.body.uploadUrl).slice(BASE_URL.length), { method: "PUT", body: oversized });
    expect(tooLarge.status).toBe(413);

    expect((await api(services, other.key, "GET", `/api/v1/attachments/${String(small.body.attachmentId)}`)).status).toBe(404);
    expect((await request(services, "/api/v1/uploads/not-a-ticket", { method: "PUT", body: PNG_BYTES })).status).toBe(404);
    expect((await request(services, "/api/v1/uploads/not-a-ticket", { method: "POST", body: PNG_BYTES })).status).toBe(405);
  });
});

describe("Rate limits", () => {
  it("limits writes, uploads, and requests per member across interfaces, with Retry-After", async () => {
    const services = createTestServices({ env: { RATE_LIMIT_REQUESTS_PER_MIN: "6", RATE_LIMIT_WRITES_PER_MIN: "2", RATE_LIMIT_UPLOADS_PER_MIN: "1" } });
    const member = await signedInMember(services, "editor-rl@example.test", "editor");
    const key = await createKeyFor(services, member.userId);
    const other = await memberWithKey(services, "editor-rl2@example.test", "editor");

    expect((await api(services, key, "POST", "/api/v1/publications", storyInput())).status).toBe(201);
    expect((await callTool(services, key, "create_publication", storyInput())).body.status).toBe("created");
    const third = await api(services, key, "POST", "/api/v1/publications", storyInput({ externalId: "rl-third" }));
    expect(third.status).toBe(429);
    expect(Number(third.headers.get("retry-after"))).toBeGreaterThan(0);
    const viaMcp = await callTool(services, key, "create_publication", storyInput());
    expect(viaMcp).toMatchObject({ isError: true, body: { status: "rate_limited" } });
    // Recorded for the owner's failure view.
    const failures = await services.db.select().from(schema.publishingFailures);
    expect(failures.some((f) => f.status === "rate_limited" && f.externalId === "rl-third")).toBe(true);

    const uploadBody = { mimeType: "image/png", size: 100, altText: "Chart" };
    expect((await api(services, key, "POST", "/api/v1/attachment-uploads", uploadBody)).status).toBe(201);
    expect((await api(services, key, "POST", "/api/v1/attachment-uploads", uploadBody)).status).toBe(429);

    // Another member is unaffected.
    expect((await api(services, other.key, "POST", "/api/v1/publications", storyInput())).status).toBe(201);

    // The overall request limit (6 so far: 4 HTTP + 2 MCP).
    const overall = await api(services, key, "GET", "/api/v1/categories");
    expect(overall.status).toBe(429);
    const mcp = await mcpRequest(services, key, "tools/list");
    expect(mcp.status).toBe(429);
    expect(mcp.headers.get("retry-after")).toBeTruthy();
  });
});

describe("Operational logging", () => {
  it("logs operation, member, credential, status, and timing, but never the key or token", async () => {
    const services = createTestServices();
    const member = await signedInMember(services, "editor-log@example.test", "editor");
    const key = await createKeyFor(services, member.userId);
    const { accessToken } = await connectAgent(services, member);
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
    vi.spyOn(console, "error").mockImplementation((line: unknown) => void lines.push(String(line)));

    const payload = storyInput({ bodyMarkdown: "Secret-ish body text that must not be logged." });
    await api(services, key, "POST", "/api/v1/publications", payload);
    await callTool(services, accessToken, "get_publication", { id: "missing" });
    await api(services, "540daily_wrong", "GET", "/api/v1/categories");
    const ticket = await api(services, key, "POST", "/api/v1/attachment-uploads", { mimeType: "image/png", size: PNG_BYTES.byteLength, altText: "Chart" });
    await request(services, String(ticket.body.uploadUrl).slice(BASE_URL.length), { method: "PUT", body: PNG_BYTES });

    const entries = lines.filter((l) => l.includes('"agent_operation"')).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(entries).toContainEqual(
      expect.objectContaining({ operation: "create_publication", interface: "http", userId: member.userId, credentialKind: "api_key", status: "created", httpStatus: 201, durationMs: expect.any(Number), operationId: expect.any(String) }),
    );
    expect(entries).toContainEqual(expect.objectContaining({ operation: "get_publication", interface: "mcp", credentialKind: "oauth", status: "not_found" }));
    expect(entries).toContainEqual(expect.objectContaining({ operation: "list_categories", status: "unauthorized", userId: null }));
    expect(entries).toContainEqual(expect.objectContaining({ operation: "complete_attachment_upload", status: "uploaded", userId: member.userId }));
    const all = lines.join("\n");
    expect(all.includes(String(ticket.body.uploadUrl).split("/").pop()!)).toBe(false);
    expect(all).not.toContain(key);
    expect(all).not.toContain(accessToken);
    expect(all).not.toContain("540daily_wrong");
    expect(all).not.toContain("Secret-ish body text");
  });
});

describe("API keys", () => {
  it("stores only a hash, shows the secret once, and only editors and the owner can create keys", async () => {
    const services = createTestServices();
    const { userId, key } = await memberWithKey(services, "editor-keys@example.test", "editor");
    expect(key).toMatch(/^540daily_[A-Za-z0-9_-]{43}$/);
    const rows = await services.db.select().from(schema.apiKeys).where(eq(schema.apiKeys.userId, userId));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(key.slice("540daily_".length));
    expect(rows[0]!.displayPrefix).toBe(key.slice(0, 15));
    const listed = await services.apiKeys.listOwn({ userId, role: "editor", status: "active" });
    expect(listed[0]).not.toHaveProperty("keyHash");

    const reader = await memberActor(services, "reader-keys@example.test", "reader");
    expect((await services.apiKeys.create({ userId: reader.userId, role: "reader", status: "active" }, "Mine")).ok).toBe(false);
    // Another editor cannot revoke this key; the owner can.
    const otherEditor = await memberActor(services, "editor-keys2@example.test", "editor");
    expect((await services.apiKeys.revoke({ userId: otherEditor.userId, role: "editor", status: "active" }, rows[0]!.id)).ok).toBe(false);
    const owner = await memberActor(services, "owner-keys@example.test", "owner");
    expect((await services.apiKeys.revoke({ userId: owner.userId, role: "owner", status: "active" }, rows[0]!.id)).ok).toBe(true);
    expect((await api(services, key, "GET", "/api/v1/categories")).status).toBe(401);
  });

  it("an editor cannot disconnect another member's MCP client; the owner can", async () => {
    const services = createTestServices();
    const member = await signedInMember(services, "editor-conn@example.test", "editor");
    const { clientId, accessToken } = await connectAgent(services, member);
    const other = await memberActor(services, "editor-conn2@example.test", "editor");
    const owner = await memberActor(services, "owner-conn@example.test", "owner");

    expect(await services.agents.listOwnConnections({ userId: member.userId, role: "editor", status: "active" })).toEqual([
      expect.objectContaining({ clientId, clientName: "Test MCP client" }),
    ]);
    expect((await services.agents.disconnect({ userId: other.userId, role: "editor", status: "active" }, { userId: member.userId, clientId })).ok).toBe(false);
    expect((await api(services, accessToken, "GET", "/api/v1/categories")).status).toBe(200);
    const ownerViewer = { userId: owner.userId, role: "owner" as const, status: "active" as const };
    expect(await services.agents.disconnect(ownerViewer, { userId: "no-such-member", clientId })).toMatchObject({ ok: false, status: "not_found" });
    expect((await services.agents.disconnect({ userId: owner.userId, role: "owner", status: "active" }, { userId: member.userId, clientId })).ok).toBe(true);
    expect((await api(services, accessToken, "GET", "/api/v1/categories")).status).toBe(401);
    expect(await services.agents.listOwnConnections({ userId: member.userId, role: "editor", status: "active" })).toEqual([]);
  });
});
