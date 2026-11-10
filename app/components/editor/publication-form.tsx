// Create and edit form for a publication, with a Markdown preview rendered on the server.
// Inputs are uncontrolled: a failed save or a preview keeps whatever the editor typed.
import { Form, useNavigation } from "react-router";
import type { PublicationFormValues } from "../../routes/editor.server";

type Errors = Record<string, string[]>;

export const BODY_FIELD_ID = "field-bodyMarkdown";

function FieldError({ id, errors }: { id: string; errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <ul className="field-error" id={id}>
      {errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  );
}

function describedBy(...ids: Array<string | false | undefined>) {
  const list = ids.filter(Boolean).join(" ");
  return list || undefined;
}

function TextField(props: {
  name: keyof PublicationFormValues;
  label: string;
  values: PublicationFormValues;
  errors: Errors;
  hint?: string;
  required?: boolean;
  maxLength?: number;
  multiline?: boolean;
  rows?: number;
  type?: string;
  list?: string;
  className?: string;
}) {
  const id = `field-${props.name}`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const errors = props.errors[props.name];
  const common = {
    id,
    name: props.name,
    defaultValue: props.values[props.name],
    required: props.required,
    maxLength: props.maxLength,
    "aria-invalid": errors?.length ? true : undefined,
    "aria-describedby": describedBy(props.hint ? hintId : undefined, errors?.length ? errorId : undefined),
  };
  return (
    <div className={`field ${props.className ?? ""}`}>
      <label htmlFor={id}>
        {props.label}
        {props.required ? null : <span className="muted"> (optional)</span>}
      </label>
      {props.hint ? (
        <p className="field-hint" id={hintId}>
          {props.hint}
        </p>
      ) : null}
      {props.multiline ? <textarea {...common} rows={props.rows ?? 4} /> : <input {...common} type={props.type ?? "text"} list={props.list} />}
      <FieldError id={errorId} errors={errors} />
    </div>
  );
}

export function PublicationForm({
  mode,
  values,
  errors,
  categories,
  expectedRevision,
  status,
  conflictRevision,
  previewHtml,
  previewError,
  historyHref,
}: {
  mode: "new" | "edit";
  values: PublicationFormValues;
  errors: Errors;
  categories: string[];
  expectedRevision?: number;
  status?: "draft" | "published" | "unpublished";
  conflictRevision?: number | null;
  previewHtml?: string | null;
  previewError?: string | null;
  historyHref?: string;
}) {
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  const typeErrors = errors.type;
  const general = errors._;
  return (
    <Form method="post" className="publication-form" aria-label={mode === "new" ? "New publication" : "Edit publication"}>
      {expectedRevision ? <input type="hidden" name="expectedRevision" value={expectedRevision} /> : null}
      {mode === "edit" ? <input type="hidden" name="sourcePublishedAtShown" value={values.sourcePublishedAt} /> : null}
      <FieldError id="form-error" errors={general} />

      <fieldset className="field">
        <legend>Type</legend>
        <div className="radio-row">
          {(["story", "report"] as const).map((t) => (
            <label key={t} className="radio">
              <input type="radio" name="type" value={t} defaultChecked={values.type === t} required aria-describedby="field-type-hint" />
              {t === "story" ? "Story" : "Report"}
            </label>
          ))}
        </div>
        <p className="field-hint" id="field-type-hint">
          Reports need a body. A daily briefing is a report tagged “briefing”.
        </p>
        <FieldError id="field-type-error" errors={typeErrors} />
      </fieldset>

      <TextField name="title" label="Title" values={values} errors={errors} required maxLength={200} />
      <TextField name="summary" label="Summary" values={values} errors={errors} required maxLength={1000} multiline rows={3} hint="Plain text, up to 1,000 characters." />
      <TextField
        name="category"
        label="Category"
        values={values}
        errors={errors}
        required
        maxLength={80}
        list="category-options"
        hint="Pick an existing category or type a new one. New categories are not added to the homepage automatically."
      />
      <datalist id="category-options">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <TextField
        name="bodyMarkdown"
        label="Body (Markdown)"
        values={values}
        errors={errors}
        multiline
        rows={16}
        className="field--body"
        hint="Required for reports. Images: upload below, then use ![description](attachment:ID). Raw HTML is shown as text."
      />
      <TextField name="tags" label="Tags" values={values} errors={errors} hint="Separate tags with commas. Up to 20." />
      <TextField name="sources" label="Sources" values={values} errors={errors} multiline rows={3} hint="One per line: the http(s) link, then an optional label. Links are not fetched." />
      <TextField name="sourcePublishedAt" label="Source date" values={values} errors={errors} type="date" hint="When the source was published. Separate from the 540 Daily publication time. A time the agent sent is kept unless you change the date." />

      <div className="form-actions">
        <button type="submit" className="button" name="intent" value="preview" disabled={busy}>
          Preview
        </button>
        {mode === "new" ? (
          <>
            <button type="submit" className="button" name="intent" value="save" disabled={busy}>
              Save draft
            </button>
            <button type="submit" className="button button--primary" name="intent" value="publish" disabled={busy}>
              Publish
            </button>
          </>
        ) : (
          <>
            <button type="submit" className="button button--primary" name="intent" value="save" disabled={busy}>
              {status === "published" ? "Save and update public page" : "Save"}
            </button>
            {status === "draft" ? (
              <button type="submit" className="button" name="intent" value="save-publish" disabled={busy}>
                Save and publish
              </button>
            ) : null}
          </>
        )}
        <span className="muted" role="status">
          {busy ? "Working…" : ""}
        </span>
      </div>

      {conflictRevision && historyHref ? (
        <div className="notice notice--error" role="alert">
          <p>
            Someone saved revision {conflictRevision} while you were editing. Your text is still here and nothing was saved. Their version stays in the history either way.
          </p>
          <p>
            <a href={historyHref} target="_blank" rel="noopener">
              Open the history in a new tab
            </a>{" "}
            to compare, or save your version on top of theirs.
          </p>
          <button type="submit" className="button" name="overrideRevision" value={conflictRevision} disabled={busy}>
            Save my version as revision {conflictRevision + 1}
          </button>
        </div>
      ) : null}

      {previewHtml !== undefined && previewHtml !== null ? (
        <section className="preview panel" aria-labelledby="preview-title">
          <h2 id="preview-title">Preview</h2>
          {previewHtml ? <div className="prose" dangerouslySetInnerHTML={{ __html: previewHtml }} /> : <p className="muted">The body is empty.</p>}
        </section>
      ) : null}
      {previewError ? (
        <p className="notice notice--error" role="alert">
          {previewError}
        </p>
      ) : null}
    </Form>
  );
}
