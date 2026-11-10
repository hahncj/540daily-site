import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { eq } from "drizzle-orm";
import { useState } from "react";
import { redirect } from "react-router";
import { roleAtLeast } from "../../server/core/access";
import { oauthClient } from "../../server/db/schema";
import { servicesContext } from "../context";
import { getViewer } from "../session.server";
import type { Route } from "./+types/consent";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Connect an agent · 540 Daily" }];
}

/** A host name for display: harder to fake than the client's self-chosen name. */
function hostOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.hostname : null;
  } catch {
    return null;
  }
}

function firstRedirectUri(value: unknown): unknown {
  if (Array.isArray(value)) return value[0];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed[0] : value;
    } catch {
      return value;
    }
  }
  return null;
}

/**
 * MCP OAuth consent. Any active member can connect an agent to their own account. The query is the
 * authorization request Better Auth signed; anything unsigned or tampered with is refused.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const query = new URL(request.url).search.slice(1);
  const valid = query.length > 0 && query.length < 8192 && (await verifyOAuthQueryParams(query, (await services.auth.$context).secret).catch(() => false));
  if (!valid) throw new Response("This connection request is invalid or has expired. Start again from your agent.", { status: 400 });

  const viewer = await getViewer(request, services);
  if (!viewer) throw redirect(`/sign-in?${query}`);

  const clientId = new URLSearchParams(query).get("client_id") ?? "";
  const [client] = await services.db
    .select({ name: oauthClient.name, redirectUris: oauthClient.redirectUris, disabled: oauthClient.disabled })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
    .limit(1);
  if (!client || client.disabled) throw new Response("This agent is not registered or has been disabled.", { status: 400 });

  // CIMD clients use their metadata URL as the client ID; others are known by their redirect URI.
  const domain = hostOf(clientId) ?? hostOf(firstRedirectUri(client.redirectUris));
  const canWrite = roleAtLeast(viewer.role, "editor");
  return {
    clientName: client.name?.trim() || "An unnamed agent",
    domain,
    memberName: viewer.name,
    roleLabel: viewer.role === "owner" ? "the owner" : viewer.role === "editor" ? "an editor" : "a reader",
    canWrite,
  };
}

export default function Consent({ loaderData }: Route.ComponentProps) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function decide(accept: boolean) {
    setBusy(true);
    setFailure(null);
    try {
      const response = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept, oauth_query: window.location.search.slice(1) }),
      });
      const result = (await response.json().catch(() => null)) as { url?: string } | null;
      if (!response.ok || !result?.url) throw new Error("consent failed");
      window.location.assign(result.url);
    } catch {
      setFailure("Could not finish connecting. Please try again, or start again from your agent.");
      setBusy(false);
    }
  }

  const { clientName, domain, roleLabel, canWrite } = loaderData;
  return (
    <section aria-labelledby="page-title" className="panel">
      <h1 id="page-title">Connect an agent</h1>
      <p>
        <strong>{clientName}</strong>
        {domain ? (
          <>
            {" "}
            from <strong>{domain}</strong>
          </>
        ) : null}{" "}
        wants to connect to your 540 Daily account.
      </p>
      <p>
        This app will act as you. You are {roleLabel}.{" "}
        {canWrite
          ? "It can read 540 Daily, publish new stories and reports, and update publications you created. It cannot unpublish, restore, or delete anything, change the homepage, or manage access."
          : "The connection is read-only: it can read and search 540 Daily but cannot publish or change anything."}
      </p>
      <p className="muted">You can disconnect it at any time from your account page.</p>
      {failure ? (
        <p className="notice notice--error" role="alert">
          {failure}
        </p>
      ) : null}
      <div className="button-row">
        <button type="button" className="button button--primary" onClick={() => decide(true)} disabled={busy}>
          {busy ? "Connecting…" : "Allow"}
        </button>{" "}
        <button type="button" className="button" onClick={() => decide(false)} disabled={busy}>
          Deny
        </button>
      </div>
    </section>
  );
}
