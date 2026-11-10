// Pieces shared by /account and /owner: credential lists, a copyable field, and page styles.
// Both pages are private: never indexed (the server also sends X-Robots-Tag: noindex).
import { useEffect, useId, useRef, useState } from "react";
import { Form } from "react-router";
import accountCss from "../../styles/account.css?url";
import { editorLinks, ErrorNotice, NOINDEX_META, Time } from "../editor/shared";

export { ErrorNotice, NOINDEX_META, Time };

export const accountLinks = () => [...editorLinks(), { rel: "stylesheet", href: accountCss }];

/** Result of every account/owner form action. `key` carries a new API key's secret, shown once. */
export type ActionResult = { ok: true; message: string; key?: string; keyLabel?: string; inviteLink?: string } | { ok: false; message: string; field?: string };

/** Success (polite status) or failure (alert) after a form action. Field errors are shown at their field instead. */
export function ActionMessage({ result, fields = [] }: { result: ActionResult | undefined; fields?: string[] }) {
  if (!result) return null;
  if (!result.ok) return result.field && fields.includes(result.field) ? null : <ErrorNotice message={result.message} />;
  return (
    <p className="notice notice--success" role="status">
      {result.message}
    </p>
  );
}

/** A read-only value with a Copy button. Without JavaScript the field can still be selected and copied. */
export function CopyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const [canCopy, setCanCopy] = useState(false);
  useEffect(() => setCanCopy(typeof navigator !== "undefined" && !!navigator.clipboard), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied("copied");
    } catch {
      input.current?.select();
      setCopied("failed");
    }
  }

  return (
    <div className="field copy-field">
      <label htmlFor={id}>{label}</label>
      {hint ? <p className="field-hint">{hint}</p> : null}
      <div className="copy-field__row">
        <input id={id} ref={input} type="text" readOnly value={value} onFocus={(e) => e.currentTarget.select()} spellCheck={false} />
        {canCopy ? (
          <button type="button" className="button" onClick={copy}>
            Copy<span className="visually-hidden"> {label}</span>
          </button>
        ) : null}
      </div>
      <p className="field-hint" role="status">
        {copied === "copied" ? "Copied." : copied === "failed" ? "Could not copy. The text is selected; copy it manually." : ""}
      </p>
    </div>
  );
}

export type ConnectionRow = { userId: string; clientId: string; clientName: string; connectedAt: string | Date; memberEmail?: string };

/** MCP connections with a Disconnect button each. `showMember` adds the member's email (owner console). */
export function ConnectionList({ connections, busy, showMember = false, empty }: { connections: ConnectionRow[]; busy: boolean; showMember?: boolean; empty: string }) {
  if (connections.length === 0) return <p className="muted">{empty}</p>;
  return (
    <ul className="item-list">
      {connections.map((c) => (
        <li key={`${c.userId}:${c.clientId}`} className="item-card">
          <div className="item-card__body">
            <p className="item-card__title">{c.clientName}</p>
            <p className="item-card__meta">
              {showMember ? (
                <>
                  <span>{c.memberEmail ?? "Unknown member"}</span> ·{" "}
                </>
              ) : null}
              connected <Time value={c.connectedAt} />
            </p>
          </div>
          <Form method="post" className="item-card__actions">
            <input type="hidden" name="intent" value="disconnect" />
            <input type="hidden" name="userId" value={c.userId} />
            <input type="hidden" name="clientId" value={c.clientId} />
            <button type="submit" className="button button--danger" disabled={busy}>
              Disconnect<span className="visually-hidden"> {c.clientName}{showMember && c.memberEmail ? ` for ${c.memberEmail}` : ""}</span>
            </button>
          </Form>
        </li>
      ))}
    </ul>
  );
}

export type KeyRow = {
  id: string;
  label: string;
  displayPrefix: string;
  createdAt: string | Date;
  lastUsedAt: string | Date | null;
  revokedAt: string | Date | null;
  memberEmail?: string;
};

/** API keys (never the secret). Active keys get a Revoke button; revoked keys stay listed for the record. */
export function KeyList({ keys, busy, showMember = false, empty }: { keys: KeyRow[]; busy: boolean; showMember?: boolean; empty: string }) {
  if (keys.length === 0) return <p className="muted">{empty}</p>;
  return (
    <ul className="item-list">
      {keys.map((k) => (
        <li key={k.id} className={`item-card${k.revokedAt ? " item-card--inactive" : ""}`}>
          <div className="item-card__body">
            <p className="item-card__title">
              {k.label} {k.revokedAt ? <span className="status-badge status-badge--unpublished">Revoked</span> : <span className="status-badge status-badge--published">Active</span>}
            </p>
            <p className="item-card__meta">
              {showMember ? (
                <>
                  <span>{k.memberEmail ?? "Unknown member"}</span> ·{" "}
                </>
              ) : null}
              <code>{k.displayPrefix}…</code> · created <Time value={k.createdAt} /> ·{" "}
              {k.lastUsedAt ? (
                <>
                  last used <Time value={k.lastUsedAt} />
                </>
              ) : (
                "never used"
              )}
              {k.revokedAt ? (
                <>
                  {" "}
                  · revoked <Time value={k.revokedAt} />
                </>
              ) : null}
            </p>
          </div>
          {k.revokedAt ? null : (
            <Form method="post" className="item-card__actions">
              <input type="hidden" name="intent" value="revoke-key" />
              <input type="hidden" name="keyId" value={k.id} />
              <button type="submit" className="button button--danger" disabled={busy}>
                Revoke<span className="visually-hidden"> key {k.label}{showMember && k.memberEmail ? ` for ${k.memberEmail}` : ""}</span>
              </button>
            </Form>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Read a string form field ("" when missing). */
export function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}
