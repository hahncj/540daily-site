// Owner console section for the daily story prompt: edit and save a new revision, copy the text,
// and view or restore earlier revisions. The server checks the owner role and the expected revision.
import { useEffect, useId, useState } from "react";
import { Form } from "react-router";
import { ErrorNotice, Time } from "./shared";

export type PromptRow = { revision: number; body: string; note: string | null; createdAt: string | Date; author: string };

/** Result of the save-prompt and restore-prompt actions, shown inside this section. */
export type PromptActionResult =
  | { section: "prompt"; ok: true; message: string }
  | { section: "prompt"; ok: false; message: string; field?: "body" | "note"; draft?: { body: string; note: string } };

export function isPromptResult(result: unknown): result is PromptActionResult {
  return !!result && typeof result === "object" && (result as { section?: unknown }).section === "prompt";
}

function CopyButton({ text }: { text: string }) {
  const [canCopy, setCanCopy] = useState(false);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => setCanCopy(typeof navigator !== "undefined" && !!navigator.clipboard), []);
  if (!canCopy) return null;
  return (
    <>
      <button
        type="button"
        className="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setState("copied");
          } catch {
            setState("failed");
          }
        }}
      >
        Copy prompt
      </button>
      <span className="field-hint" role="status">
        {state === "copied" ? "Copied." : state === "failed" ? "Could not copy. Select the text and copy it manually." : ""}
      </span>
    </>
  );
}

export function PromptEditor({
  current,
  history,
  maxLength,
  busy,
  result,
}: {
  current: PromptRow | null;
  history: PromptRow[];
  maxLength: number;
  busy: boolean;
  result: PromptActionResult | undefined;
}) {
  const bodyId = useId();
  const noteId = useId();
  const failed = result && !result.ok ? result : undefined;
  const initialBody = failed?.draft?.body ?? current?.body ?? "";
  const [length, setLength] = useState(initialBody.length);
  useEffect(() => setLength(initialBody.length), [initialBody]);
  const revision = current?.revision ?? 0;

  return (
    <>
      {result?.ok ? (
        <p className="notice notice--success" role="status">
          {result.message}
        </p>
      ) : failed && !failed.field ? (
        <ErrorNotice message={failed.message} />
      ) : null}
      <p className="muted">
        {current ? (
          <>
            Revision {current.revision}, saved <Time value={current.createdAt} /> by {current.author}.
          </>
        ) : (
          "No prompt saved yet. Your agents get a not-found result until you save one."
        )}{" "}
        Your agents read it with <code>get_daily_story_prompt</code> or the <code>daily_story</code> MCP prompt. Only you and your own agents can read it.
      </p>
      <Form method="post" className="prompt-form" aria-label="Daily story prompt" key={`${revision}-${failed ? "draft" : "saved"}`}>
        <input type="hidden" name="intent" value="save-prompt" />
        <input type="hidden" name="expectedRevision" value={revision} />
        <div className="field field--body">
          <label htmlFor={bodyId}>Prompt</label>
          <textarea
            id={bodyId}
            name="body"
            rows={18}
            required
            maxLength={maxLength}
            defaultValue={initialBody}
            spellCheck={false}
            onChange={(e) => setLength(e.currentTarget.value.length)}
            aria-invalid={failed?.field === "body" || undefined}
            aria-describedby={`${bodyId}-count${failed?.field === "body" ? ` ${bodyId}-error` : ""}`}
          />
          <p id={`${bodyId}-count`} className="field-hint">
            {length.toLocaleString("en-US")} of {maxLength.toLocaleString("en-US")} characters
          </p>
          {failed?.field === "body" ? (
            <p id={`${bodyId}-error`} className="field-error" role="alert">
              {failed.message}
            </p>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor={noteId}>What changed (optional)</label>
          <input
            id={noteId}
            name="note"
            type="text"
            maxLength={200}
            autoComplete="off"
            defaultValue={failed?.draft?.note ?? ""}
            aria-invalid={failed?.field === "note" || undefined}
            aria-describedby={failed?.field === "note" ? `${noteId}-error` : undefined}
          />
          {failed?.field === "note" ? (
            <p id={`${noteId}-error`} className="field-error" role="alert">
              {failed.message}
            </p>
          ) : null}
        </div>
        <div className="prompt-form__actions">
          <button type="submit" className="button button--primary" disabled={busy}>
            Save prompt
          </button>
          {current ? <CopyButton text={current.body} /> : null}
        </div>
      </Form>

      <h3>History</h3>
      {history.length === 0 ? (
        <p className="muted">No revisions yet.</p>
      ) : (
        <ul className="item-list">
          {history.map((r) => (
            <li key={r.revision} className="item-card">
              <div className="item-card__body">
                <p className="item-card__title">
                  Revision {r.revision}
                  {r.revision === revision ? " (current)" : ""}
                </p>
                <p className="item-card__meta">
                  <Time value={r.createdAt} /> · {r.author}
                  {r.note ? ` · ${r.note}` : ""}
                </p>
                <details className="prompt-revision">
                  <summary>
                    View text<span className="visually-hidden"> of revision {r.revision}</span>
                  </summary>
                  <pre>{r.body}</pre>
                </details>
              </div>
              {r.revision === revision ? null : (
                <Form method="post" className="item-card__actions">
                  <input type="hidden" name="intent" value="restore-prompt" />
                  <input type="hidden" name="revision" value={r.revision} />
                  <input type="hidden" name="expectedRevision" value={revision} />
                  <button type="submit" className="button" disabled={busy}>
                    Restore<span className="visually-hidden"> revision {r.revision}</span>
                  </button>
                </Form>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
