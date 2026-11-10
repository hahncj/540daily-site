// /owner: the owner console. Invitations, roles, account status, every member's MCP connections and
// API keys, recent publishing failures, and the explicit cleanup of old unreferenced uploads.
// Every loader and action requires an active owner on the server; core services check again.
import { Form, data, useNavigation } from "react-router";
import { ROLES, type Role } from "../../server/core/access";
import { HTTP_STATUS, type FailureStatus } from "../../server/core/result";
import { requireRolePage, requireRoleWrite } from "../access.server";
import { accountLinks, ActionMessage, ConnectionList, CopyField, field, KeyList, NOINDEX_META, Time, type ActionResult } from "../components/account/shared";
import { servicesContext } from "../context";
import type { Route } from "./+types/owner";

export const links = accountLinks;

export function meta(_: Route.MetaArgs) {
  return [{ title: "Owner · 540 Daily" }, NOINDEX_META];
}

const ROLE_LABEL: Record<Role, string> = { reader: "Reader", editor: "Editor", owner: "Owner" };

function notFoundUnlessRoot(params: Record<string, string | undefined>) {
  if (params["*"]) throw new Response("Page not found.", { status: 404 });
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const viewer = await requireRolePage(request, services, "owner");
  notFoundUnlessRoot(params);
  const [members, invitations, connections, keys, failures] = await Promise.all([
    services.members.listMembers(viewer),
    services.members.listInvitations(viewer),
    services.agents.listAllConnections(viewer),
    services.apiKeys.listAll(viewer),
    services.publishingFailures.listRecent(viewer, 50),
  ]);
  if (!members || !invitations || !connections || !keys || !failures) throw new Response("You don't have access to this page.", { status: 403 });

  const emailOf = new Map(members.map((m) => [m.userId, m.email]));
  const keyLabel = new Map(keys.map((k) => [k.id, k.label]));
  const clientName = new Map(connections.map((c) => [c.clientId, c.clientName]));
  return {
    viewerId: viewer.userId,
    signInLink: `${services.config.baseUrl}/sign-in`,
    members: members.map(({ userId, email, name, role, status, createdAt }) => ({ userId, email, name, role, status, createdAt })),
    invitations: invitations.map(({ id, email, createdAt }) => ({ id, email, createdAt })),
    connections: connections.map((c) => ({ ...c, memberEmail: emailOf.get(c.userId) })),
    keys: keys.map(({ id, userId, label, displayPrefix, createdAt, lastUsedAt, revokedAt }) => ({
      id,
      label,
      displayPrefix,
      createdAt,
      lastUsedAt,
      revokedAt,
      memberEmail: emailOf.get(userId),
    })),
    failures: failures.map((f) => ({
      id: f.id,
      createdAt: f.createdAt,
      memberEmail: f.userId ? (emailOf.get(f.userId) ?? "Removed member") : "Unknown member",
      via:
        f.credentialKind === "api_key"
          ? `API key ${(f.credentialId && keyLabel.get(f.credentialId)) || ""}`.trim()
          : f.credentialKind === "oauth"
            ? (f.credentialId && clientName.get(f.credentialId)) || "MCP client"
            : "Editor",
      operation: f.operation,
      status: f.status,
      message: f.message,
      externalId: f.externalId,
    })),
  };
}

function refused(status: FailureStatus | number, message: string, fieldName?: string) {
  const code = typeof status === "number" ? status : HTTP_STATUS[status];
  return data<ActionResult>({ ok: false, message, ...(fieldName ? { field: fieldName } : {}) }, { status: code });
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  const viewer = await requireRoleWrite(request, services, "owner");
  notFoundUnlessRoot(params);
  const form = await request.formData();
  const intent = field(form, "intent");

  switch (intent) {
    case "invite": {
      const result = await services.members.invite(viewer, field(form, "email"));
      if (!result.ok) return refused(result.status, result.errors?.email?.join(" ") ?? result.message, "email");
      return {
        ok: true,
        message: `Invitation added for ${result.value.email}. Send them the sign-in link; they must sign in with that Google account.`,
        inviteLink: `${services.config.baseUrl}/sign-in`,
      } satisfies ActionResult;
    }
    case "revoke-invitation": {
      const result = await services.members.revokeInvitation(viewer, field(form, "invitationId"));
      if (!result.ok) return refused(result.status, result.message);
      return { ok: true, message: "Invitation revoked. That email can no longer register." } satisfies ActionResult;
    }
    case "change-role": {
      const result = await services.members.changeRole(viewer, field(form, "userId"), field(form, "role"));
      if (!result.ok) return refused(result.status, result.message);
      return { ok: true, message: `${result.value.email} is now ${ROLE_LABEL[result.value.role].toLowerCase()}.` } satisfies ActionResult;
    }
    case "disable":
    case "enable": {
      const result = await services.members.setStatus(viewer, field(form, "userId"), intent === "disable" ? "disabled" : "active");
      if (!result.ok) return refused(result.status, result.message);
      const who = result.value.email;
      return {
        ok: true,
        message: intent === "disable" ? `${who} is disabled. Their sessions and agents stopped working.` : `${who} is active again.`,
      } satisfies ActionResult;
    }
    case "disconnect": {
      const result = await services.agents.disconnect(viewer, { userId: field(form, "userId"), clientId: field(form, "clientId") });
      if (!result.ok) return refused(result.status, result.message);
      return { ok: true, message: "MCP client disconnected." } satisfies ActionResult;
    }
    case "revoke-key": {
      const result = await services.apiKeys.revoke(viewer, field(form, "keyId"));
      if (!result.ok) return refused(result.status, result.message);
      return { ok: true, message: "API key revoked." } satisfies ActionResult;
    }
    case "cleanup-uploads": {
      if (field(form, "confirm") !== "yes") return refused(422, "Tick the box to confirm the permanent deletion.", "confirm");
      const result = await services.attachments.cleanupUnreferenced(viewer);
      if (!result.ok) return refused(result.status, result.message);
      const n = result.value.deleted;
      return { ok: true, message: n === 0 ? "No unreferenced uploads older than seven days were found." : `Deleted ${n} unreferenced upload${n === 1 ? "" : "s"}.` } satisfies ActionResult;
    }
    default:
      return refused(400, "Unknown action.");
  }
}

const SECTIONS = [
  ["invitations", "Invitations"],
  ["members", "Members"],
  ["connections", "MCP connections"],
  ["keys", "API keys"],
  ["failures", "Publishing failures"],
  ["uploads", "Uploads"],
] as const;

export default function Owner({ loaderData, actionData }: Route.ComponentProps) {
  const { viewerId, signInLink, members, invitations, connections, keys, failures } = loaderData;
  const busy = useNavigation().state !== "idle";
  const result = actionData as ActionResult | undefined;
  const emailError = result && !result.ok && result.field === "email";

  return (
    <section aria-labelledby="page-title" className="account-page">
      <h1 id="page-title">Owner console</h1>
      <nav className="owner-nav" aria-label="Owner console sections">
        <ul>
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`}>{label}</a>
            </li>
          ))}
        </ul>
      </nav>
      <ActionMessage result={result} fields={["email"]} />

      <section id="invitations" aria-labelledby="invitations-title" className="account-section">
        <h2 id="invitations-title">Invitations</h2>
        <p className="muted">Invite an exact email address as a reader. No email is sent: share the sign-in link yourself. They must sign in with that Google account.</p>
        <Form method="post" className="inline-form" aria-label="Invite a reader">
          <input type="hidden" name="intent" value="invite" />
          <div className="field">
            <label htmlFor="invite-email">Email address</label>
            <input
              id="invite-email"
              name="email"
              type="email"
              required
              autoComplete="off"
              aria-invalid={emailError || undefined}
              aria-describedby={emailError ? "invite-email-error" : undefined}
            />
            {emailError ? (
              <p id="invite-email-error" className="field-error" role="alert">
                {result.message}
              </p>
            ) : null}
          </div>
          <button type="submit" className="button button--primary" disabled={busy}>
            Invite reader
          </button>
        </Form>
        <CopyField label="Sign-in link" value={signInLink} />
        <h3>Open invitations</h3>
        {invitations.length === 0 ? (
          <p className="muted">No open invitations.</p>
        ) : (
          <ul className="item-list">
            {invitations.map((i) => (
              <li key={i.id} className="item-card">
                <div className="item-card__body">
                  <p className="item-card__title">{i.email}</p>
                  <p className="item-card__meta">
                    Reader · invited <Time value={i.createdAt} />
                  </p>
                </div>
                <Form method="post" className="item-card__actions">
                  <input type="hidden" name="intent" value="revoke-invitation" />
                  <input type="hidden" name="invitationId" value={i.id} />
                  <button type="submit" className="button button--danger" disabled={busy}>
                    Revoke<span className="visually-hidden"> invitation for {i.email}</span>
                  </button>
                </Form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="members" aria-labelledby="members-title" className="account-section">
        <h2 id="members-title">Members</h2>
        <p className="muted">Change roles or disable accounts. Disabling ends the member's sessions and stops their agents. The only active owner cannot be demoted or disabled.</p>
        <ul className="item-list">
          {members.map((m) => {
            const self = m.userId === viewerId;
            return (
              <li key={m.userId} className={`item-card${m.status === "disabled" ? " item-card--inactive" : ""}`}>
                <div className="item-card__body">
                  <p className="item-card__title">
                    {m.email}
                    {self ? " (you)" : ""}{" "}
                    {m.status === "disabled" ? <span className="status-badge status-badge--unpublished">Disabled</span> : null}
                  </p>
                  <p className="item-card__meta">
                    {m.name} · {ROLE_LABEL[m.role]} · member since <Time value={m.createdAt} />
                  </p>
                </div>
                <div className="item-card__actions">
                  <Form method="post" className="item-card__actions">
                    <input type="hidden" name="intent" value="change-role" />
                    <input type="hidden" name="userId" value={m.userId} />
                    <label className="visually-hidden" htmlFor={`role-${m.userId}`}>
                      Role for {m.email}
                    </label>
                    <select id={`role-${m.userId}`} name="role" defaultValue={m.role} key={m.role}>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="button" disabled={busy}>
                      Change role<span className="visually-hidden"> for {m.email}</span>
                    </button>
                  </Form>
                  {self ? null : (
                    <Form method="post">
                      <input type="hidden" name="userId" value={m.userId} />
                      {m.status === "active" ? (
                        <button type="submit" name="intent" value="disable" className="button button--danger" disabled={busy}>
                          Disable<span className="visually-hidden"> {m.email}</span>
                        </button>
                      ) : (
                        <button type="submit" name="intent" value="enable" className="button" disabled={busy}>
                          Enable<span className="visually-hidden"> {m.email}</span>
                        </button>
                      )}
                    </Form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section id="connections" aria-labelledby="connections-title" className="account-section">
        <h2 id="connections-title">MCP connections</h2>
        <p className="muted">Every member's approved AI clients. Disconnecting refuses the client's tokens at once.</p>
        <ConnectionList connections={connections} busy={busy} showMember empty="No MCP clients are connected." />
      </section>

      <section id="keys" aria-labelledby="keys-title" className="account-section">
        <h2 id="keys-title">API keys</h2>
        <p className="muted">Every member's API keys. Members create their own keys on their account page; you can revoke any of them.</p>
        <KeyList keys={keys} busy={busy} showMember empty="No API keys exist." />
      </section>

      <section id="failures" aria-labelledby="failures-title" className="account-section">
        <h2 id="failures-title">Recent publishing failures</h2>
        <p className="muted">Refused agent publishing attempts from the last 30 days, newest first (up to 50).</p>
        {failures.length === 0 ? (
          <p className="muted">No publishing failures in the last 30 days.</p>
        ) : (
          <ul className="item-list">
            {failures.map((f) => (
              <li key={f.id} className="item-card">
                <div className="item-card__body">
                  <p className="item-card__title">
                    {f.operation}: {f.status}
                  </p>
                  <p className="item-card__meta">
                    <Time value={f.createdAt} /> · {f.memberEmail} via {f.via}
                    {f.externalId ? (
                      <>
                        {" "}
                        · external ID <code>{f.externalId}</code>
                      </>
                    ) : null}
                  </p>
                  <p className="item-card__meta">{f.message}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="uploads" aria-labelledby="uploads-title" className="account-section">
        <h2 id="uploads-title">Upload cleanup</h2>
        <p className="muted">
          Permanently delete uploaded images that no publication or revision references and that are older than seven days. Referenced images are always kept. This cannot be undone.
        </p>
        <Form method="post" className="inline-form">
          <input type="hidden" name="intent" value="cleanup-uploads" />
          <label className="radio">
            <input type="checkbox" name="confirm" value="yes" required /> I understand these uploads are deleted permanently
          </label>
          <button type="submit" className="button button--danger" disabled={busy}>
            Delete old unreferenced uploads
          </button>
        </Form>
      </section>
    </section>
  );
}
