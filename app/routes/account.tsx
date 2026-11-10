// /account: the signed-in member's MCP connections and, for editors and the owner, API keys.
// Every action re-checks the member on the server and acts only on the member's own credentials.
import { Form, data, useNavigation } from "react-router";
import { hasRole } from "../../server/core/access";
import { HTTP_STATUS, type FailureStatus } from "../../server/core/result";
import { requireRolePage, requireRoleWrite } from "../access.server";
import { accountLinks, ActionMessage, ConnectionList, CopyField, field, KeyList, NOINDEX_META, type ActionResult } from "../components/account/shared";
import { servicesContext } from "../context";
import type { Route } from "./+types/account";

export const links = accountLinks;

/** Same limit the API key service enforces (server/api-keys.ts); repeated here to keep server code out of the browser bundle. */
const MAX_KEY_LABEL = 80;

export function meta(_: Route.MetaArgs) {
  return [{ title: "Account · 540 Daily" }, NOINDEX_META];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const viewer = await requireRolePage(request, services, "reader");
  const canUseKeys = hasRole(viewer, "editor");
  const [connections, keys] = await Promise.all([services.agents.listOwnConnections(viewer), canUseKeys ? services.apiKeys.listOwn(viewer) : Promise.resolve([])]);
  const base = services.config.baseUrl;
  return {
    email: viewer.email,
    name: viewer.name,
    role: viewer.role,
    canUseKeys,
    mcpUrl: `${base}/mcp`,
    apiUrl: `${base}/api/v1`,
    connections,
    keys: keys.map(({ id, label, displayPrefix, createdAt, lastUsedAt, revokedAt }) => ({ id, label, displayPrefix, createdAt, lastUsedAt, revokedAt })),
  };
}

function refused(status: FailureStatus | number, message: string, fieldName?: string) {
  const code = typeof status === "number" ? status : HTTP_STATUS[status];
  return data<ActionResult>({ ok: false, message, ...(fieldName ? { field: fieldName } : {}) }, { status: code });
}

export async function action({ request, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  const viewer = await requireRoleWrite(request, services, "reader");
  const form = await request.formData();
  const intent = field(form, "intent");

  if (intent === "create-key") {
    const result = await services.apiKeys.create(viewer, field(form, "label"));
    if (!result.ok) return refused(result.status, result.errors?.label ? `Key name: ${result.errors.label.join(" ")}` : result.message, "label");
    return { ok: true, message: `API key "${result.value.info.label}" created. Copy it now: it will not be shown again.`, key: result.value.key, keyLabel: result.value.info.label } satisfies ActionResult;
  }

  if (intent === "revoke-key") {
    const keyId = field(form, "keyId");
    // This page manages only the member's own keys, even for the owner (who uses /owner for others').
    const own = (await services.apiKeys.listOwn(viewer)).find((k) => k.id === keyId);
    if (!own) return refused("not_found", "API key not found.");
    const result = await services.apiKeys.revoke(viewer, keyId);
    if (!result.ok) return refused(result.status, result.message);
    return { ok: true, message: `API key "${own.label}" revoked. Agents using it can no longer connect.` } satisfies ActionResult;
  }

  if (intent === "disconnect") {
    const clientId = field(form, "clientId");
    const own = (await services.agents.listOwnConnections(viewer)).find((c) => c.clientId === clientId);
    if (!own) return refused("not_found", "Connection not found.");
    const result = await services.agents.disconnect(viewer, { userId: viewer.userId, clientId });
    if (!result.ok) return refused(result.status, result.message);
    return { ok: true, message: `${own.clientName} disconnected. It must sign in again to reconnect.` } satisfies ActionResult;
  }

  return refused(400, "Unknown action.");
}

const ROLE_LABEL = { reader: "Reader", editor: "Editor", owner: "Owner" } as const;

export default function Account({ loaderData, actionData }: Route.ComponentProps) {
  const { email, name, role, canUseKeys, mcpUrl, apiUrl, connections, keys } = loaderData;
  const busy = useNavigation().state !== "idle";
  const result = actionData as ActionResult | undefined;
  const labelError = result && !result.ok && result.field === "label";

  return (
    <section aria-labelledby="page-title" className="account-page">
      <h1 id="page-title">Account</h1>
      <p>
        Signed in as <strong>{name}</strong> ({email}). Role: <strong>{ROLE_LABEL[role]}</strong>.
      </p>
      <ActionMessage result={result} />

      <section aria-labelledby="connections-title" className="account-section">
        <h2 id="connections-title">MCP connections</h2>
        <p className="muted">
          {canUseKeys
            ? "AI clients you approved act as you, with your current role. They can create publications and update only your own."
            : "AI clients you approved act as you and can read and search published content. Readers' agents cannot publish."}
        </p>
        <CopyField label="MCP server URL" value={mcpUrl} hint="Add this URL to your AI client, then approve it with your Google account." />
        <ConnectionList connections={connections} busy={busy} empty="No MCP clients are connected." />
      </section>

      {canUseKeys ? (
        <section aria-labelledby="keys-title" className="account-section">
          <h2 id="keys-title">API keys</h2>
          <p className="muted">
            A key lets an agent use the HTTP API at <code>{apiUrl}</code> (or MCP) as you. Send it as <code>Authorization: Bearer &lt;key&gt;</code>. Only a fingerprint of each key is stored.
          </p>
          {result?.ok && result.key ? (
            <div className="panel secret-panel">
              <h3>New key: {result.keyLabel}</h3>
              <CopyField label="API key (shown once)" value={result.key} hint="Store it in your agent's secret settings now. 540 Daily cannot show it again." />
            </div>
          ) : null}
          <Form method="post" className="inline-form" aria-label="Create an API key">
            <input type="hidden" name="intent" value="create-key" />
            <div className="field">
              <label htmlFor="key-label">Key name</label>
              <input
                id="key-label"
                name="label"
                type="text"
                required
                maxLength={MAX_KEY_LABEL}
                placeholder="For example: Research agent"
                aria-invalid={labelError || undefined}
                aria-describedby={labelError ? "key-label-error" : undefined}
              />
              {labelError ? (
                <p id="key-label-error" className="field-error">
                  {result.message}
                </p>
              ) : null}
            </div>
            <button type="submit" className="button button--primary" disabled={busy}>
              Create API key
            </button>
          </Form>
          <KeyList keys={keys} busy={busy} empty="You have no API keys." />
        </section>
      ) : (
        <p className="muted">API keys are available to editors and the owner.</p>
      )}
    </section>
  );
}
