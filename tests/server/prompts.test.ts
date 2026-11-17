// Agent prompts: the owner saves and restores the daily story prompt; the owner's agents read it over
// MCP (tool and prompt) and HTTP. Local only: in-memory SQLite. All prompt text here is test data.
import { describe, expect, it } from "vitest";
import * as schema from "../../server/db/schema";
import { MAX_PROMPT_LENGTH } from "../../server/core/prompts";
import { api, callTool, mcpRequest, mcpResult, memberWithKey, readMcpMessages } from "../helpers/agents";
import { memberActor } from "../helpers/publishing";
import { createTestServices } from "../helpers/services";

const PROMPT_V1 = "Test prompt v1: research test topics and publish test stories (test data).";
const PROMPT_V2 = "Test prompt v2: a revised test prompt (test data).";

describe("prompts core", () => {
  it("is not_found until the first save, then saves revisions in order", async () => {
    const services = createTestServices();
    const owner = await memberActor(services, "owner-p1@example.test", "owner");

    const before = await services.prompts.get(owner, "daily_story");
    expect(before).toMatchObject({ ok: false, status: "not_found" });

    const first = await services.prompts.update(owner, "daily_story", { body: `\r\n${PROMPT_V1}\r\nline two\r\n\r\n`, expectedRevision: "0" });
    expect(first).toMatchObject({ ok: true, value: { revision: 1, body: `${PROMPT_V1}\nline two`, note: null, createdByUserId: owner.userId } });

    const second = await services.prompts.update(owner, "daily_story", { body: PROMPT_V2, note: "  Tightened sports rules  ", expectedRevision: 1 });
    expect(second).toMatchObject({ ok: true, value: { revision: 2, body: PROMPT_V2, note: "Tightened sports rules" } });

    const current = await services.prompts.get(owner, "daily_story");
    expect(current).toMatchObject({ ok: true, value: { revision: 2, body: PROMPT_V2 } });
    const history = await services.prompts.history(owner, "daily_story");
    expect(history.ok && history.value.map((r) => r.revision)).toEqual([2, 1]);
  });

  it("refuses a stale revision with the current one, and unchanged text", async () => {
    const services = createTestServices();
    const owner = await memberActor(services, "owner-p2@example.test", "owner");
    await services.prompts.update(owner, "daily_story", { body: PROMPT_V1, expectedRevision: 0 });

    const stale = await services.prompts.update(owner, "daily_story", { body: PROMPT_V2, expectedRevision: 0 });
    expect(stale).toMatchObject({ ok: false, status: "conflict", currentRevision: 1 });

    const same = await services.prompts.update(owner, "daily_story", { body: `${PROMPT_V1}\n`, expectedRevision: 1 });
    expect(same).toMatchObject({ ok: false, status: "invalid" });
  });

  it("validates the body and note", async () => {
    const services = createTestServices();
    const owner = await memberActor(services, "owner-p3@example.test", "owner");
    const empty = await services.prompts.update(owner, "daily_story", { body: "  \n ", expectedRevision: 0 });
    expect(empty).toMatchObject({ ok: false, status: "invalid", errors: { body: ["Enter the prompt."] } });
    const long = await services.prompts.update(owner, "daily_story", { body: "x".repeat(MAX_PROMPT_LENGTH + 1), expectedRevision: 0 });
    expect(long).toMatchObject({ ok: false, status: "invalid" });
    expect(long.ok ? null : long.errors?.body).toBeTruthy();
    const note = await services.prompts.update(owner, "daily_story", { body: PROMPT_V1, note: "n".repeat(201), expectedRevision: 0 });
    expect(note.ok ? null : note.errors?.note).toBeTruthy();
    const fits = await services.prompts.update(owner, "daily_story", { body: "x".repeat(MAX_PROMPT_LENGTH), expectedRevision: 0 });
    expect(fits.ok).toBe(true);
  });

  it("restore copies an old revision into a new one", async () => {
    const services = createTestServices();
    const owner = await memberActor(services, "owner-p4@example.test", "owner");
    await services.prompts.update(owner, "daily_story", { body: PROMPT_V1, expectedRevision: 0 });
    await services.prompts.update(owner, "daily_story", { body: PROMPT_V2, expectedRevision: 1 });

    const restored = await services.prompts.restore(owner, "daily_story", { revision: "1", expectedRevision: "2" });
    expect(restored).toMatchObject({ ok: true, value: { revision: 3, body: PROMPT_V1, note: "Restored revision 1" } });

    expect(await services.prompts.restore(owner, "daily_story", { revision: 3, expectedRevision: 3 })).toMatchObject({ ok: false, status: "invalid" });
    expect(await services.prompts.restore(owner, "daily_story", { revision: 9, expectedRevision: 3 })).toMatchObject({ ok: false, status: "not_found" });
    expect(await services.prompts.restore(owner, "daily_story", { revision: 2, expectedRevision: 2 })).toMatchObject({ ok: false, status: "conflict", currentRevision: 3 });
  });

  it("only the owner can read history or write; editors and readers cannot read", async () => {
    const services = createTestServices();
    const owner = await memberActor(services, "owner-p5@example.test", "owner");
    await services.prompts.update(owner, "daily_story", { body: PROMPT_V1, expectedRevision: 0 });
    for (const role of ["editor", "reader"] as const) {
      const member = await memberActor(services, `${role}-p5@example.test`, role);
      expect(await services.prompts.get(member, "daily_story")).toMatchObject({ ok: false, status: "forbidden" });
      expect(await services.prompts.history(member, "daily_story")).toMatchObject({ ok: false, status: "forbidden" });
      expect(await services.prompts.update(member, "daily_story", { body: PROMPT_V2, expectedRevision: 1 })).toMatchObject({ ok: false, status: "forbidden" });
      expect(await services.prompts.restore(member, "daily_story", { revision: 1, expectedRevision: 1 })).toMatchObject({ ok: false, status: "forbidden" });
    }
    const ownerAgent = { kind: "agent" as const, userId: owner.userId, role: "owner" as const, credentialKind: "api_key" as const, credentialId: "k1", label: "Test key" };
    expect(await services.prompts.get(ownerAgent, "daily_story")).toMatchObject({ ok: true });
    expect(await services.prompts.update(ownerAgent, "daily_story", { body: PROMPT_V2, expectedRevision: 1 })).toMatchObject({ ok: false, status: "forbidden" });
  });

  it("audits saves without the prompt text", async () => {
    const services = createTestServices();
    const owner = await memberActor(services, "owner-p6@example.test", "owner");
    await services.prompts.update(owner, "daily_story", { body: PROMPT_V1, note: "first", expectedRevision: 0 });
    await services.prompts.restore(owner, "daily_story", { revision: 1, expectedRevision: 1 }); // refused: unchanged
    const rows = await services.db.select().from(schema.auditEvents);
    const promptRows = rows.filter((r) => r.action.startsWith("prompt."));
    expect(promptRows).toHaveLength(1);
    expect(promptRows[0]).toMatchObject({ action: "prompt.update", targetType: "prompt", targetId: "daily_story" });
    expect(JSON.stringify(promptRows[0])).not.toContain("Test prompt v1");
  });
});

describe("prompts over MCP and HTTP", () => {
  async function ownerWithPrompt() {
    const services = createTestServices();
    const { userId, key } = await memberWithKey(services, "owner-p7@example.test", "owner");
    await services.prompts.update({ kind: "member", userId, role: "owner" }, "daily_story", { body: PROMPT_V1, expectedRevision: 0 });
    return { services, key };
  }

  it("the tool and HTTP route return the same body", async () => {
    const { services, key } = await ownerWithPrompt();
    const viaMcp = await callTool(services, key, "get_daily_story_prompt");
    const viaHttp = await api(services, key, "GET", "/api/v1/prompts/daily-story");
    expect(viaMcp.isError).toBe(false);
    expect(viaHttp.status).toBe(200);
    expect(viaHttp.headers.get("cache-control")).toBe("no-store");
    expect(viaMcp.body).toEqual(viaHttp.body);
    expect(viaHttp.body.prompt).toMatchObject({ key: "daily_story", title: "Daily story prompt", revision: 1, text: PROMPT_V1 });
    expect((await api(services, key, "POST", "/api/v1/prompts/daily-story", {})).status).toBe(405);
    expect((await api(services, key, "GET", "/api/v1/prompts/other")).status).toBe(404);
  });

  it("returns not_found before the owner saves a prompt", async () => {
    const services = createTestServices();
    const { key } = await memberWithKey(services, "owner-p8@example.test", "owner");
    const out = await api(services, key, "GET", "/api/v1/prompts/daily-story");
    expect(out.status).toBe(404);
    expect(out.body.status).toBe("not_found");
  });

  it("lists the tool, the prompt, and the instruction only to the owner's agents", async () => {
    const { services, key } = await ownerWithPrompt();
    const { key: editorKey } = await memberWithKey(services, "editor-p9@example.test", "editor");

    const ownerTools = (await mcpResult(services, key, "tools/list")) as { tools: Array<{ name: string }> };
    expect(ownerTools.tools.map((t) => t.name)).toContain("get_daily_story_prompt");
    const editorTools = (await mcpResult(services, editorKey, "tools/list")) as { tools: Array<{ name: string }> };
    expect(editorTools.tools.map((t) => t.name)).not.toContain("get_daily_story_prompt");

    const ownerPrompts = (await mcpResult(services, key, "prompts/list")) as { prompts: Array<{ name: string; arguments?: Array<{ name: string }> }> };
    expect(ownerPrompts.prompts.map((p) => p.name)).toEqual(["daily_story"]);
    expect(ownerPrompts.prompts[0]!.arguments?.map((a) => a.name)).toEqual(["focus"]);
    const editorPrompts = await mcpRequest(services, editorKey, "prompts/list");
    const [editorMessage] = await readMcpMessages(editorPrompts);
    expect((editorMessage?.result as { prompts?: unknown[] } | undefined)?.prompts ?? []).toEqual([]);

    const ownerInit = (await mcpResult(services, key, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    })) as { instructions?: string };
    expect(ownerInit.instructions).toContain("get_daily_story_prompt");
    const editorInit = (await mcpResult(services, editorKey, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    })) as { instructions?: string };
    expect(editorInit.instructions).not.toContain("get_daily_story_prompt");

    // Editors calling the tool or route directly are refused.
    expect((await api(services, editorKey, "GET", "/api/v1/prompts/daily-story")).status).toBe(403);
  });

  it("prompts/get returns the saved text, with an optional focus note", async () => {
    const { services, key } = await ownerWithPrompt();
    const plain = (await mcpResult(services, key, "prompts/get", { name: "daily_story" })) as { messages: Array<{ role: string; content: { type: string; text: string } }> };
    expect(plain.messages).toEqual([{ role: "user", content: { type: "text", text: PROMPT_V1 } }]);

    const focused = (await mcpResult(services, key, "prompts/get", { name: "daily_story", arguments: { focus: "Test focus: sports only" } })) as {
      messages: Array<{ content: { text: string } }>;
    };
    expect(focused.messages[0]!.content.text).toBe(`${PROMPT_V1}\n\n## Focus for this run\n\nTest focus: sports only`);
  });

  it("prompts/get is an error before the owner saves a prompt", async () => {
    const services = createTestServices();
    const { key } = await memberWithKey(services, "owner-p10@example.test", "owner");
    const response = await mcpRequest(services, key, "prompts/get", { name: "daily_story" });
    const [message] = await readMcpMessages(response);
    expect(JSON.stringify(message?.error)).toContain("No daily story prompt has been saved yet");
  });
});
