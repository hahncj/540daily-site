// Lane 3A: the /account page and the /owner console, through their real loaders and actions over the
// real services and in-memory SQLite. Exit checks: A2 complete, A3 (access side), A6 through the UI.
// Local only: Google's signature check is faked (see tests/helpers/services.ts). All identities are test data.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as accountRoute from "../../app/routes/account";
import * as ownerRoute from "../../app/routes/owner";
import { getViewer } from "../../app/session.server";
import * as schema from "../../server/db/schema";
import { api, connectAgent, mcpRequest } from "../helpers/agents";
import { PNG_BYTES, storyInput, testClock, uploadImage } from "../helpers/publishing";
import { run } from "../helpers/routes";
import { BASE_URL, createMember, createTestServices, sessionCookieFor, signInWithGoogle, type TestServices } from "../helpers/services";

type Fields = Record<string, string>;

function get(path: string, cookie?: string) {
  return new Request(`${BASE_URL}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
}

function post(path: string, cookie: string | null, fields: Fields, origin = BASE_URL) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  const headers: Record<string, string> = { Origin: origin };
  if (cookie) headers.Cookie = cookie;
  return new Request(`${BASE_URL}${path}`, { method: "POST", headers, body });
}

const ownerAction = (services: TestServices, cookie: string | null, fields: Fields) => run(ownerRoute.action, services, post("/owner", cookie, fields), { "*": "" });
const ownerLoader = (services: TestServices, cookie?: string) => run(ownerRoute.loader, services, get("/owner", cookie), { "*": "" });
const accountAction = (services: TestServices, cookie: string | null, fields: Fields) => run(accountRoute.action, services, post("/account", cookie, fields));
const accountLoader = (services: TestServices, cookie?: string) => run(accountRoute.loader, services, get("/account", cookie));

type ActionData = { ok: boolean; message: string; key?: string; inviteLink?: string; field?: string };
type AccountData = { canUseKeys: boolean; connections: Array<{ clientId: string; userId: string }>; keys: Array<{ id: string; label: string; revokedAt: Date | null }> };
type OwnerData = {
  signInLink: string;
  members: Array<{ userId: string; email: string; role: string; status: string }>;
  invitations: Array<{ id: string; email: string }>;
  connections: Array<{ userId: string; clientId: string; memberEmail?: string }>;
  keys: Array<{ id: string; label: string; memberEmail?: string; revokedAt: Date | null }>;
  failures: Array<{ operation: string; status: string; memberEmail: string; via: string }>;
};

function cookieFrom(response: Response) {
  return response.headers.getSetCookie().find((c) => c.startsWith("better-auth.session_token="))?.split(";")[0];
}

async function setup() {
  const services = createTestServices();
  const owner = await sessionCookieFor(services, "owner-3a@example.test", "owner");
  return { services, owner };
}

async function membership(services: TestServices, userId: string) {
  const [row] = await services.db.select().from(schema.memberships).where(eq(schema.memberships.userId, userId));
  return row!;
}

/** Create a key through the account page, as a member would. Returns the secret shown once. */
async function createKeyViaUi(services: TestServices, cookie: string, label = "Test agent key") {
  const r = await accountAction(services, cookie, { intent: "create-key", label });
  expect(r.status, JSON.stringify(r.data)).toBe(200);
  const out = r.data as ActionData;
  expect(out.ok).toBe(true);
  return out.key!;
}

async function keyIdFor(services: TestServices, cookie: string, label: string) {
  const data = (await accountLoader(services, cookie)).data as AccountData;
  return data.keys.find((k) => k.label === label)!.id;
}

describe("A2: invitations, roles, and account status through the owner console", () => {
  it("the owner invites an exact email, copies the sign-in link, and the invitee registers as a reader", async () => {
    const { services, owner } = await setup();
    const invited = await ownerAction(services, owner.cookie, { intent: "invite", email: "  New.Reader@Example.test " });
    expect(invited.status).toBe(200);
    expect(invited.data).toMatchObject({ ok: true, inviteLink: `${BASE_URL}/sign-in` });

    const page = (await ownerLoader(services, owner.cookie)).data as OwnerData;
    expect(page.signInLink).toBe(`${BASE_URL}/sign-in`);
    expect(page.invitations.map((i) => i.email)).toEqual(["new.reader@example.test"]);

    // A Gmail-style alias of the invited address is a different address and is refused.
    expect((await signInWithGoogle(services, { email: "new.reader+alias@example.test" })).status).toBe(403);
    const signIn = await signInWithGoogle(services, { email: "NEW.READER@example.test" });
    expect(signIn.status).toBe(200);
    const after = (await ownerLoader(services, owner.cookie)).data as OwnerData;
    expect(after.invitations).toEqual([]);
    expect(after.members.find((m) => m.email === "new.reader@example.test")).toMatchObject({ role: "reader", status: "active" });
  });

  it("refuses invalid, duplicate, and already-member invitations", async () => {
    const { services, owner } = await setup();
    await createMember(services, "existing@example.test", "reader");
    const bad = await ownerAction(services, owner.cookie, { intent: "invite", email: "not-an-email" });
    expect(bad.status).toBe(422);
    expect(bad.data).toMatchObject({ ok: false, field: "email" });
    expect((await ownerAction(services, owner.cookie, { intent: "invite", email: "dup@example.test" })).status).toBe(200);
    expect((await ownerAction(services, owner.cookie, { intent: "invite", email: "DUP@example.test" })).status).toBe(409);
    const member = await ownerAction(services, owner.cookie, { intent: "invite", email: "Existing@example.test" });
    expect(member.status).toBe(409);
    expect((member.data as ActionData).message).toContain("already a member");
  });

  it("a revoked invitation cannot be used to register", async () => {
    const { services, owner } = await setup();
    await ownerAction(services, owner.cookie, { intent: "invite", email: "revoke-me@example.test" });
    const { invitations } = (await ownerLoader(services, owner.cookie)).data as OwnerData;
    const revoked = await ownerAction(services, owner.cookie, { intent: "revoke-invitation", invitationId: invitations[0]!.id });
    expect(revoked.status).toBe(200);
    expect(((await ownerLoader(services, owner.cookie)).data as OwnerData).invitations).toEqual([]);
    expect((await ownerAction(services, owner.cookie, { intent: "revoke-invitation", invitationId: invitations[0]!.id })).status).toBe(404);

    expect((await signInWithGoogle(services, { email: "revoke-me@example.test" })).status).toBe(403);
    expect(await services.db.select().from(schema.user).where(eq(schema.user.email, "revoke-me@example.test"))).toHaveLength(0);
  });

  it("the owner promotes a reader to editor and demotes them back; the change applies on the next request", async () => {
    const { services, owner } = await setup();
    const reader = await sessionCookieFor(services, "promote-me@example.test", "reader");
    expect((await run(ownerRoute.loader, services, get("/owner", reader.cookie), { "*": "" })).status).toBe(403);

    expect((await ownerAction(services, owner.cookie, { intent: "change-role", userId: reader.userId, role: "editor" })).status).toBe(200);
    expect((await membership(services, reader.userId)).role).toBe("editor");
    expect(((await accountLoader(services, reader.cookie)).data as AccountData).canUseKeys).toBe(true);

    expect((await ownerAction(services, owner.cookie, { intent: "change-role", userId: reader.userId, role: "reader" })).status).toBe(200);
    expect(((await accountLoader(services, reader.cookie)).data as AccountData).canUseKeys).toBe(false);
    expect((await ownerAction(services, owner.cookie, { intent: "change-role", userId: reader.userId, role: "admin" })).status).toBe(422);
    expect((await ownerAction(services, owner.cookie, { intent: "change-role", userId: "missing", role: "editor" })).status).toBe(404);
    const audit = await services.db.select().from(schema.auditEvents).where(eq(schema.auditEvents.action, "member.role_change"));
    expect(audit).toHaveLength(2);
  });

  it("disabling ends the member's sessions and blocks sign-in; enabling lets them back in", async () => {
    const { services, owner } = await setup();
    await ownerAction(services, owner.cookie, { intent: "invite", email: "disable-me@example.test" });
    const signIn = await signInWithGoogle(services, { email: "disable-me@example.test", sub: "disable-sub" });
    const cookie = cookieFrom(signIn)!;
    const [user] = await services.db.select().from(schema.user).where(eq(schema.user.email, "disable-me@example.test"));

    const disabled = await ownerAction(services, owner.cookie, { intent: "disable", userId: user!.id });
    expect(disabled.status).toBe(200);
    expect((await membership(services, user!.id)).status).toBe("disabled");
    expect(await services.db.select().from(schema.session).where(eq(schema.session.userId, user!.id))).toHaveLength(0);
    expect(await getViewer(get("/", cookie), services)).toBeNull();
    expect((await signInWithGoogle(services, { email: "disable-me@example.test", sub: "disable-sub" })).status).toBe(403);
    // Public reading is unaffected: the visitor is simply signed out.
    expect((await accountLoader(services, cookie)).status).toBe(302);

    expect((await ownerAction(services, owner.cookie, { intent: "enable", userId: user!.id })).status).toBe(200);
    expect((await signInWithGoogle(services, { email: "disable-me@example.test", sub: "disable-sub" })).status).toBe(200);
  });

  it("the sole owner cannot be demoted or disabled; with a second owner, demotion works", async () => {
    const { services, owner } = await setup();
    const selfDemote = await ownerAction(services, owner.cookie, { intent: "change-role", userId: owner.userId, role: "editor" });
    expect(selfDemote.status).toBe(409);
    expect((selfDemote.data as ActionData).message).toContain("only active owner");
    expect((await ownerAction(services, owner.cookie, { intent: "disable", userId: owner.userId })).status).toBe(403);
    expect(await membership(services, owner.userId)).toMatchObject({ role: "owner", status: "active" });

    // A disabled second owner does not count as another active owner.
    const second = await sessionCookieFor(services, "second-owner@example.test", "reader");
    await ownerAction(services, owner.cookie, { intent: "change-role", userId: second.userId, role: "owner" });
    await ownerAction(services, owner.cookie, { intent: "disable", userId: second.userId });
    expect((await ownerAction(services, owner.cookie, { intent: "change-role", userId: owner.userId, role: "editor" })).status).toBe(409);

    await ownerAction(services, owner.cookie, { intent: "enable", userId: second.userId });
    expect((await ownerAction(services, owner.cookie, { intent: "change-role", userId: owner.userId, role: "editor" })).status).toBe(200);
    expect((await membership(services, owner.userId)).role).toBe("editor");
    // Now `second` is the sole owner and is protected in turn.
    const secondCookie = (await sessionCookieFor(services, "third@example.test", "owner")).cookie;
    await ownerAction(services, secondCookie, { intent: "disable", userId: second.userId });
    const third = (await services.db.select().from(schema.user).where(eq(schema.user.email, "third@example.test")))[0]!;
    expect((await services.members.changeRole({ userId: second.userId, role: "owner", status: "active" }, third.id, "reader")).ok).toBe(false);
  });

  it("only the owner can invite or change roles (A2, A3)", async () => {
    const { services } = await setup();
    const editor = await sessionCookieFor(services, "editor-3a@example.test", "editor");
    const reader = await sessionCookieFor(services, "reader-3a@example.test", "reader");
    for (const cookie of [editor.cookie, reader.cookie]) {
      expect((await ownerLoader(services, cookie)).status).toBe(403);
      for (const fields of <Fields[]>[
        { intent: "invite", email: "x@example.test" },
        { intent: "change-role", userId: reader.userId, role: "editor" },
        { intent: "disable", userId: reader.userId },
        { intent: "cleanup-uploads" },
      ]) {
        expect((await ownerAction(services, cookie, fields)).status).toBe(403);
      }
    }
    expect((await ownerAction(services, null, { intent: "invite", email: "x@example.test" })).status).toBe(401);
    expect((await ownerLoader(services)).status).toBe(302);
    expect(await services.db.select().from(schema.invitations)).toHaveLength(0);
    expect((await membership(services, reader.userId)).role).toBe("reader");
    // Core refuses too, whatever the caller.
    const asEditor = { userId: editor.userId, role: "editor" as const, status: "active" as const };
    expect(await services.members.listMembers(asEditor)).toBeNull();
    expect((await services.members.changeRole(asEditor, editor.userId, "owner")).ok).toBe(false);
    expect((await services.members.revokeInvitation(asEditor, "any")).ok).toBe(false);
    expect((await services.members.setStatus(asEditor, reader.userId, "disabled")).ok).toBe(false);
  });

  it("refuses cross-origin writes and unknown owner sub-pages", async () => {
    const { services, owner } = await setup();
    const cross = await run(ownerRoute.action, services, post("/owner", owner.cookie, { intent: "invite", email: "x@example.test" }, "https://evil.example"), { "*": "" });
    expect(cross.status).toBe(403);
    const crossAccount = await run(accountRoute.action, services, post("/account", owner.cookie, { intent: "create-key", label: "x" }, "https://evil.example"));
    expect(crossAccount.status).toBe(403);
    expect((await run(ownerRoute.loader, services, get("/owner/other", owner.cookie), { "*": "other" })).status).toBe(404);
  });
});

describe("A3: editors manage only their own credentials", () => {
  it("an editor sees only their own keys and connections, and cannot revoke or disconnect another member's", async () => {
    const { services } = await setup();
    const a = await sessionCookieFor(services, "editor-a-3a@example.test", "editor");
    const b = await sessionCookieFor(services, "editor-b-3a@example.test", "editor");
    await createKeyViaUi(services, a.cookie, "A key");
    const bKey = await createKeyViaUi(services, b.cookie, "B key");
    const bClient = await connectAgent(services, b, { clientName: "B client" });

    const aPage = (await accountLoader(services, a.cookie)).data as AccountData;
    expect(aPage.keys.map((k) => k.label)).toEqual(["A key"]);
    expect(aPage.connections).toEqual([]);

    const bKeyId = await keyIdFor(services, b.cookie, "B key");
    const revoke = await accountAction(services, a.cookie, { intent: "revoke-key", keyId: bKeyId });
    expect(revoke.status).toBe(404);
    const disconnect = await accountAction(services, a.cookie, { intent: "disconnect", userId: b.userId, clientId: bClient.clientId });
    expect(disconnect.status).toBe(404);
    expect((await ownerAction(services, a.cookie, { intent: "revoke-key", keyId: bKeyId })).status).toBe(403);
    expect((await ownerAction(services, a.cookie, { intent: "disconnect", userId: b.userId, clientId: bClient.clientId })).status).toBe(403);

    // B's credentials still work.
    expect((await api(services, bKey, "GET", "/api/v1/categories")).status).toBe(200);
    expect((await api(services, bClient.accessToken, "GET", "/api/v1/categories")).status).toBe(200);
  });

  it("readers see their connections but cannot create keys", async () => {
    const { services } = await setup();
    const reader = await sessionCookieFor(services, "reader-keys@example.test", "reader");
    await connectAgent(services, reader, { clientName: "Reader client" });
    const page = (await accountLoader(services, reader.cookie)).data as AccountData;
    expect(page.canUseKeys).toBe(false);
    expect(page.keys).toEqual([]);
    expect(page.connections).toHaveLength(1);
    const create = await accountAction(services, reader.cookie, { intent: "create-key", label: "Nope" });
    expect(create.status).toBe(403);
    expect(await services.db.select().from(schema.apiKeys)).toHaveLength(0);
  });

  it("signed-out visitors are sent to sign-in", async () => {
    const { services } = await setup();
    const r = await accountLoader(services);
    expect(r.status).toBe(302);
    expect(r.response?.headers.get("Location")).toBe("/sign-in?next=%2Faccount");
    expect((await accountAction(services, null, { intent: "create-key", label: "x" })).status).toBe(401);
  });
});

describe("A6 through the account and owner pages", () => {
  it("a key created on /account is shown once, publishes as its member, and stops working when revoked there", async () => {
    const { services } = await setup();
    const editor = await sessionCookieFor(services, "editor-a6-ui@example.test", "editor");
    const key = await createKeyViaUi(services, editor.cookie, "Research agent");
    expect(key).toMatch(/^540daily_[A-Za-z0-9_-]{43}$/);
    // The page never shows the secret again, and only a hash is stored.
    const page = (await accountLoader(services, editor.cookie)).data as AccountData;
    expect(JSON.stringify(page)).not.toContain(key);
    const [row] = await services.db.select().from(schema.apiKeys);
    expect(JSON.stringify(row)).not.toContain(key);

    const created = await api(services, key, "POST", "/api/v1/publications", storyInput());
    expect(created.status).toBe(201);
    expect(created.body.publication).toMatchObject({ createdBy: { kind: "agent", label: "Research agent", isYou: true } });

    const keyId = await keyIdFor(services, editor.cookie, "Research agent");
    const revoked = await accountAction(services, editor.cookie, { intent: "revoke-key", keyId });
    expect(revoked.status).toBe(200);
    expect(((await accountLoader(services, editor.cookie)).data as AccountData).keys[0]!.revokedAt).not.toBeNull();
    expect((await api(services, key, "POST", "/api/v1/publications", storyInput())).status).toBe(401);
    expect((await mcpRequest(services, key, "tools/list")).status).toBe(401);
  });

  it("a client disconnected on /account fails on its next call", async () => {
    const { services } = await setup();
    const editor = await sessionCookieFor(services, "editor-a6-mcp@example.test", "editor");
    const client = await connectAgent(services, editor, { clientName: "Desk client" });
    const page = (await accountLoader(services, editor.cookie)).data as AccountData;
    expect(page.connections.map((c) => c.clientId)).toEqual([client.clientId]);

    expect((await accountAction(services, editor.cookie, { intent: "disconnect", clientId: client.clientId })).status).toBe(200);
    expect(((await accountLoader(services, editor.cookie)).data as AccountData).connections).toEqual([]);
    expect((await mcpRequest(services, client.accessToken, "tools/list")).status).toBe(401);
  });

  it("the owner revokes any member's key and disconnects any member's client from /owner", async () => {
    const { services, owner } = await setup();
    const editor = await sessionCookieFor(services, "editor-owner-revoke@example.test", "editor");
    const key = await createKeyViaUi(services, editor.cookie, "Editor key");
    const client = await connectAgent(services, editor, { clientName: "Editor client" });

    const page = (await ownerLoader(services, owner.cookie)).data as OwnerData;
    const listedKey = page.keys.find((k) => k.label === "Editor key")!;
    expect(listedKey.memberEmail).toBe("editor-owner-revoke@example.test");
    expect(page.connections).toEqual([expect.objectContaining({ clientId: client.clientId, memberEmail: "editor-owner-revoke@example.test" })]);
    expect(JSON.stringify(page)).not.toContain(key);

    expect((await ownerAction(services, owner.cookie, { intent: "revoke-key", keyId: listedKey.id })).status).toBe(200);
    expect((await ownerAction(services, owner.cookie, { intent: "disconnect", userId: editor.userId, clientId: client.clientId })).status).toBe(200);
    expect((await api(services, key, "GET", "/api/v1/categories")).status).toBe(401);
    expect((await api(services, client.accessToken, "GET", "/api/v1/categories")).status).toBe(401);
  });

  it("agents of a member the owner demotes or disables cannot write", async () => {
    const { services, owner } = await setup();
    const demoted = await sessionCookieFor(services, "demote-a6@example.test", "editor");
    const disabled = await sessionCookieFor(services, "disable-a6@example.test", "editor");
    const demotedKey = await createKeyViaUi(services, demoted.cookie);
    const disabledKey = await createKeyViaUi(services, disabled.cookie);
    expect((await api(services, demotedKey, "POST", "/api/v1/publications", storyInput())).status).toBe(201);

    await ownerAction(services, owner.cookie, { intent: "change-role", userId: demoted.userId, role: "reader" });
    expect((await api(services, demotedKey, "POST", "/api/v1/publications", storyInput())).status).toBe(403);
    await ownerAction(services, owner.cookie, { intent: "disable", userId: disabled.userId });
    expect((await api(services, disabledKey, "POST", "/api/v1/publications", storyInput())).status).toBe(401);
  });
});

describe("Owner console: publishing failures and upload cleanup", () => {
  it("lists recent publishing failures with the member and credential", async () => {
    const { services, owner } = await setup();
    const reader = await sessionCookieFor(services, "reader-failure@example.test", "reader");
    await ownerAction(services, owner.cookie, { intent: "change-role", userId: reader.userId, role: "editor" });
    const key = await createKeyViaUi(services, reader.cookie, "Failing key");
    expect((await api(services, key, "POST", "/api/v1/publications", { externalId: "bad-1", title: "" })).status).toBe(422);

    const page = (await ownerLoader(services, owner.cookie)).data as OwnerData;
    expect(page.failures[0]).toMatchObject({ memberEmail: "reader-failure@example.test", via: "API key Failing key", status: "invalid" });
  });

  it("deletes only unreferenced uploads older than seven days", async () => {
    const clock = testClock();
    const services = createTestServices({ now: clock.now });
    const owner = await sessionCookieFor(services, "owner-cleanup@example.test", "owner");
    const actor = { kind: "member" as const, userId: owner.userId, role: "owner" as const };
    const old = await uploadImage(services, actor, PNG_BYTES);
    clock.advance(8 * 24 * 3600 * 1000);
    const recent = await uploadImage(services, actor, PNG_BYTES);

    const r = await ownerAction(services, owner.cookie, { intent: "cleanup-uploads" });
    expect(r.status).toBe(200);
    expect((r.data as ActionData).message).toBe("Deleted 1 unreferenced upload.");
    const left = (await services.db.select({ id: schema.attachments.id }).from(schema.attachments)).map((a) => a.id);
    expect(left).toEqual([recent]);
    expect(left).not.toContain(old);
    expect(((await ownerAction(services, owner.cookie, { intent: "cleanup-uploads" })).data as ActionData).message).toContain("No unreferenced uploads");
  });
});
