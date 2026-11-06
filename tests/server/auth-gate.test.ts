import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getViewer } from "../../app/session.server";
import * as schema from "../../server/db/schema";
import { createMember, createTestServices, OWNER_EMAIL, request, signInWithGoogle, type TestServices } from "../helpers/services";

// These run Better Auth's real Google ID-token sign-in endpoint, user creation, database hooks, and
// session cookies against in-memory SQLite. Only Google's token signature check is faked.

function cookieFrom(response: Response) {
  const setCookie = response.headers.getSetCookie().find((c) => c.startsWith("better-auth.session_token="));
  return setCookie?.split(";")[0];
}

async function usersWithEmail(services: TestServices, email: string) {
  return services.db.select().from(schema.user).where(eq(schema.user.email, email));
}

describe("Google sign-in membership gate (A2, partial)", () => {
  let services: TestServices;
  beforeEach(() => {
    services = createTestServices();
  });

  it("A2: an uninvited Google identity cannot register", async () => {
    const response = await signInWithGoogle(services, { email: "stranger@example.test" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "not_invited" });
    expect(cookieFrom(response)).toBeUndefined();
    expect(await usersWithEmail(services, "stranger@example.test")).toHaveLength(0);
    expect(await services.db.select().from(schema.session)).toHaveLength(0);
  });

  it("A2: the OWNER_EMAIL identity can register and becomes the owner", async () => {
    const response = await signInWithGoogle(services, { email: OWNER_EMAIL });
    expect(response.status).toBe(200);
    const cookie = cookieFrom(response);
    expect(cookie).toBeDefined();

    const [owner] = await usersWithEmail(services, OWNER_EMAIL);
    expect(owner).toBeDefined();
    const [membership] = await services.db.select().from(schema.memberships).where(eq(schema.memberships.userId, owner!.id));
    expect(membership).toMatchObject({ role: "owner", status: "active" });

    const viewer = await getViewer(new Request("http://localhost:5173/", { headers: { cookie: cookie! } }), services);
    expect(viewer).toMatchObject({ email: OWNER_EMAIL, role: "owner", status: "active" });
  });

  it("the viewer carries the Google profile picture for the header", async () => {
    const picture = "https://lh3.googleusercontent.com/a/test-picture";
    const response = await signInWithGoogle(services, { email: OWNER_EMAIL, picture });
    const viewer = await getViewer(new Request("http://localhost:5173/", { headers: { cookie: cookieFrom(response)! } }), services);
    expect(viewer).toMatchObject({ email: OWNER_EMAIL, image: picture });
  });

  it("the viewer image is null when Google sends no picture", async () => {
    const response = await signInWithGoogle(services, { email: OWNER_EMAIL });
    const viewer = await getViewer(new Request("http://localhost:5173/", { headers: { cookie: cookieFrom(response)! } }), services);
    expect(viewer?.image).toBeNull();
  });

  it("A2: the owner email matches case-insensitively", async () => {
    const response = await signInWithGoogle(services, { email: OWNER_EMAIL.toUpperCase() });
    expect(response.status).toBe(200);
  });

  it("A2: an invited email registers as a reader and the invitation is accepted", async () => {
    const ownerId = await createMember(services, "owner-actor@example.test", "owner");
    const invited = await services.members.invite({ userId: ownerId, role: "owner", status: "active" }, "Invited.Reader@example.test");
    expect(invited.ok).toBe(true);

    const response = await signInWithGoogle(services, { email: "invited.reader@example.test" });
    expect(response.status).toBe(200);
    const [member] = await usersWithEmail(services, "invited.reader@example.test");
    const [membership] = await services.db.select().from(schema.memberships).where(eq(schema.memberships.userId, member!.id));
    expect(membership).toMatchObject({ role: "reader", status: "active" });
    const [invitation] = await services.db.select().from(schema.invitations);
    expect(invitation?.acceptedUserId).toBe(member!.id);
  });

  it("A2: only the owner can invite", async () => {
    const editorId = await createMember(services, "editor@example.test", "editor");
    const outcome = await services.members.invite({ userId: editorId, role: "editor", status: "active" }, "someone@example.test");
    expect(outcome).toEqual({ ok: false, status: "forbidden" });
    expect(await services.db.select().from(schema.invitations)).toHaveLength(0);
  });

  it("A2: a revoked invitation does not allow registration", async () => {
    const ownerId = await createMember(services, "owner-actor@example.test", "owner");
    await services.members.invite({ userId: ownerId, role: "owner", status: "active" }, "revoked@example.test");
    await services.db.update(schema.invitations).set({ revokedAt: new Date() });

    const response = await signInWithGoogle(services, { email: "revoked@example.test" });
    expect(response.status).toBe(403);
    expect(await usersWithEmail(services, "revoked@example.test")).toHaveLength(0);
  });

  it("A2: an unverified Google email is refused", async () => {
    const response = await signInWithGoogle(services, { email: OWNER_EMAIL, emailVerified: false });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(cookieFrom(response)).toBeUndefined();
    expect(await usersWithEmail(services, OWNER_EMAIL)).toHaveLength(0);
  });

  it("A2: a disabled member cannot sign in again", async () => {
    const first = await signInWithGoogle(services, { email: OWNER_EMAIL, sub: "owner-sub" });
    expect(first.status).toBe(200);
    // A second, invited reader who is later disabled.
    const ownerRow = (await usersWithEmail(services, OWNER_EMAIL))[0]!;
    await services.members.invite({ userId: ownerRow.id, role: "owner", status: "active" }, "later-disabled@example.test");
    expect((await signInWithGoogle(services, { email: "later-disabled@example.test", sub: "reader-sub" })).status).toBe(200);
    const reader = (await usersWithEmail(services, "later-disabled@example.test"))[0]!;
    await services.db.update(schema.memberships).set({ status: "disabled" }).where(eq(schema.memberships.userId, reader.id));

    const again = await signInWithGoogle(services, { email: "later-disabled@example.test", sub: "reader-sub" });
    expect(again.status).toBe(403);
    expect(cookieFrom(again)).toBeUndefined();
  });

  it("getViewer returns null for a disabled member's existing session", async () => {
    const response = await signInWithGoogle(services, { email: OWNER_EMAIL });
    const cookie = cookieFrom(response)!;
    await services.db.update(schema.memberships).set({ status: "disabled" });
    const viewer = await getViewer(new Request("http://localhost:5173/", { headers: { cookie } }), services);
    expect(viewer).toBeNull();
  });

  it("the Better Auth session endpoint works through the dispatcher", async () => {
    const response = await signInWithGoogle(services, { email: OWNER_EMAIL });
    const session = await request(services, "/api/auth/get-session", { headers: { cookie: cookieFrom(response)! } });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({ user: { email: OWNER_EMAIL } });
  });
});
