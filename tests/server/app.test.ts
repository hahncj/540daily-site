import { describe, expect, it } from "vitest";
import { loadConfig } from "../../server/config";
import { BASE_URL, createTestServices, request } from "../helpers/services";

describe("handleRequest dispatch", () => {
  it("/health reports database and media checks without secrets", async () => {
    const services = createTestServices();
    const response = await request(services, "/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, host: "node", checks: { database: "ok", media: "ok" } });
  });

  it("/health returns 503 when a dependency fails", async () => {
    const services = createTestServices();
    services.media.failing = true;
    const response = await request(services, "/health");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, checks: { database: "ok", media: "failed" } });
  });

  it("routes /api/auth and /.well-known to Better Auth", async () => {
    const services = createTestServices();
    const session = await request(services, "/api/auth/get-session");
    expect(session.status).toBe(200);
    const discovery = await request(services, "/.well-known/oauth-protected-resource/mcp");
    expect(discovery.status).toBe(200);
    expect(await discovery.json()).toMatchObject({ resource: `${BASE_URL}/mcp` });
  });

  it("/mcp and /api/v1 are reserved until lane 2A builds them", async () => {
    const services = createTestServices();
    expect((await request(services, "/mcp", { method: "POST" })).status).toBe(503);
    expect((await request(services, "/api/v1/categories")).status).toBe(503);
  });

  it("attachments are not served before the visibility check exists", async () => {
    const services = createTestServices();
    expect((await request(services, "/attachments/anything")).status).toBe(404);
  });

  it("everything else goes to React Router", async () => {
    const services = createTestServices();
    const response = await request(services, "/categories");
    expect(await response.text()).toBe("<html>page</html>");
  });

  it("marks private paths noindex and leaves public pages indexable", async () => {
    const services = createTestServices();
    for (const path of ["/sign-in", "/consent", "/dashboard", "/saved", "/account", "/editor", "/editor/new", "/owner", "/api/v1/x", "/mcp"]) {
      expect((await request(services, path)).headers.get("x-robots-tag"), path).toBe("noindex");
    }
    for (const path of ["/", "/categories", "/categories/technology", "/publications/abc", "/search", "/sitemap.xml"]) {
      expect((await request(services, path)).headers.get("x-robots-tag"), path).toBeNull();
    }
  });
});

describe("loadConfig", () => {
  it("lists every invalid variable in one error", () => {
    expect(() => loadConfig({ PUBLIC_BASE_URL: "not a url", BETTER_AUTH_SECRET: "short" }, "node")).toThrow(
      /PUBLIC_BASE_URL[\s\S]*OWNER_EMAIL[\s\S]*BETTER_AUTH_SECRET/,
    );
  });

  it("normalizes the base URL and owner email", () => {
    const config = loadConfig(
      {
        PUBLIC_BASE_URL: "https://540daily.example/",
        OWNER_EMAIL: " Owner@Example.TEST ",
        BETTER_AUTH_SECRET: "x".repeat(32),
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
      },
      "cloudflare",
    );
    expect(config).toMatchObject({
      baseUrl: "https://540daily.example",
      ownerEmail: "owner@example.test",
      clientIpHeaders: ["cf-connecting-ip"],
      rateLimits: { requests: 60, writes: 10, uploads: 5 },
    });
  });
});
