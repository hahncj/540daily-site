import { describe, expect, it } from "vitest";
import { requireRolePage, requireRoleWrite, safeNextPath } from "../../app/access.server";
import { loader as editorLoader } from "../../app/routes/editor";
import { loader as ownerLoader } from "../../app/routes/owner";
import { loader as dashboardLoader } from "../../app/routes/dashboard";
import { isSameOriginWrite } from "../../server/same-origin";
import { BASE_URL, createTestServices, sessionCookieFor } from "../helpers/services";
import { run } from "../helpers/routes";

const post = (headers: Record<string, string>) => new Request(`${BASE_URL}/editor`, { method: "POST", headers });

describe("same-origin check for cookie writes", () => {
  it("accepts a matching Origin and rejects others", () => {
    expect(isSameOriginWrite(post({ origin: BASE_URL }), BASE_URL)).toBe(true);
    expect(isSameOriginWrite(post({ origin: "https://evil.example" }), BASE_URL)).toBe(false);
    expect(isSameOriginWrite(post({ "sec-fetch-site": "same-origin" }), BASE_URL)).toBe(true);
    expect(isSameOriginWrite(post({ "sec-fetch-site": "cross-site" }), BASE_URL)).toBe(false);
    expect(isSameOriginWrite(post({}), BASE_URL)).toBe(false);
    expect(isSameOriginWrite(new Request(`${BASE_URL}/editor`), BASE_URL)).toBe(true);
  });
});

describe("role checks", () => {
  it("A1: writes without a session fail with 401", async () => {
    const services = createTestServices();
    const error = await requireRoleWrite(post({ origin: BASE_URL }), services, "reader").catch((e) => e);
    expect(error).toBeInstanceOf(Response);
    expect(error.status).toBe(401);
  });

  it("cross-origin writes fail with 403 even for the owner", async () => {
    const services = createTestServices();
    const { cookie } = await sessionCookieFor(services, "owner2@example.test", "owner");
    const error = await requireRoleWrite(post({ origin: "https://evil.example", cookie }), services, "reader").catch((e) => e);
    expect(error.status).toBe(403);
  });

  it("A3: a reader cannot pass an editor write check; an editor cannot pass an owner check", async () => {
    const services = createTestServices();
    const reader = await sessionCookieFor(services, "reader@example.test", "reader");
    const editor = await sessionCookieFor(services, "editor@example.test", "editor");
    expect((await requireRoleWrite(post({ origin: BASE_URL, cookie: reader.cookie }), services, "editor").catch((e) => e)).status).toBe(403);
    expect((await requireRoleWrite(post({ origin: BASE_URL, cookie: editor.cookie }), services, "owner").catch((e) => e)).status).toBe(403);
    const viewer = await requireRoleWrite(post({ origin: BASE_URL, cookie: editor.cookie }), services, "editor");
    expect(viewer).toMatchObject({ role: "editor", email: "editor@example.test" });
  });

  it("protected pages redirect signed-out visitors to sign-in with a return path", async () => {
    const services = createTestServices();
    const error = await requireRolePage(new Request(`${BASE_URL}/dashboard?x=1`), services, "reader").catch((e) => e);
    expect(error.status).toBe(302);
    expect(error.headers.get("location")).toBe("/sign-in?next=%2Fdashboard%3Fx%3D1");
  });

  it("page loaders enforce their roles", async () => {
    const services = createTestServices();
    const reader = await sessionCookieFor(services, "reader@example.test", "reader");
    const editor = await sessionCookieFor(services, "editor@example.test", "editor");
    const owner = await sessionCookieFor(services, "owner2@example.test", "owner");
    const get = (path: string, cookie: string) => new Request(`${BASE_URL}${path}`, { headers: { cookie } });

    expect((await run(dashboardLoader, services, get("/dashboard", reader.cookie))).status).toBe(200);
    expect((await run(editorLoader, services, get("/editor", reader.cookie))).status).toBe(403);
    expect((await run(editorLoader, services, get("/editor", editor.cookie))).status).toBe(200);
    expect((await run(ownerLoader, services, get("/owner", editor.cookie))).status).toBe(403);
    expect((await run(ownerLoader, services, get("/owner", owner.cookie))).status).toBe(200);
  });
});

describe("safeNextPath", () => {
  it("allows only same-site relative paths", () => {
    expect(safeNextPath("/dashboard?x=1")).toBe("/dashboard?x=1");
    expect(safeNextPath("https://evil.example/")).toBe("/");
    expect(safeNextPath("//evil.example/")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});
