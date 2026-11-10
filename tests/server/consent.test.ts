// The MCP OAuth consent page loader. Local only; identities are test data.
import { describe, expect, it } from "vitest";
import { loader } from "../../app/routes/consent";
import { authorize, registerClient } from "../helpers/agents";
import { run } from "../helpers/routes";
import { BASE_URL, createTestServices, sessionCookieFor } from "../helpers/services";

async function consentQuery(role: "reader" | "editor" | "owner") {
  const services = createTestServices();
  const member = await sessionCookieFor(services, `${role}-consent@example.test`, role);
  const clientId = await registerClient(services, "Consent test client");
  const { location } = await authorize(services, member.cookie, clientId);
  return { services, member, query: location.slice("/consent?".length) };
}

const call = (services: ReturnType<typeof createTestServices>, query: string, cookie?: string) =>
  run(loader, services, new Request(`${BASE_URL}/consent?${query}`, { headers: cookie ? { Cookie: cookie } : {} }));

describe("A13: consent page", () => {
  it("shows an editor the client, its domain, and what it can do", async () => {
    const { services, member, query } = await consentQuery("editor");
    const out = await call(services, query, member.cookie);
    expect(out.status).toBe(200);
    expect(out.data).toMatchObject({ clientName: "Consent test client", domain: "127.0.0.1", canWrite: true, roleLabel: "an editor" });
  });

  it("tells a reader the connection is read-only", async () => {
    const { services, member, query } = await consentQuery("reader");
    expect((await call(services, query, member.cookie)).data).toMatchObject({ canWrite: false, roleLabel: "a reader" });
  });

  it("sends a signed-out visitor to sign-in with the signed query", async () => {
    const { services, query } = await consentQuery("editor");
    const out = await call(services, query);
    expect(out.status).toBe(302);
    expect(out.response?.headers.get("location")).toBe(`/sign-in?${query}`);
  });

  it("refuses a missing or tampered query", async () => {
    const { services, member, query } = await consentQuery("editor");
    expect((await call(services, "", member.cookie)).status).toBe(400);
    const tampered = query.replace("Consent", "x").replace(/client_id=[^&]+/, "client_id=someone-else");
    expect((await call(services, tampered, member.cookie)).status).toBe(400);
  });
});
