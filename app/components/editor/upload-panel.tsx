// Image upload for editors. Uses a fetcher, so uploading never resets the publication form.
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { BODY_FIELD_ID } from "./publication-form";

type UploadResult =
  | { ok: true; attachment: { id: string; altText: string }; markdown: string }
  | { ok: false; message: string; errors?: Record<string, string[]> };

export function UploadPanel() {
  const fetcher = useFetcher<UploadResult>();
  const formRef = useRef<HTMLFormElement>(null);
  const [inserted, setInserted] = useState<string | null>(null);
  const busy = fetcher.state !== "idle";
  const result = fetcher.data;

  useEffect(() => {
    if (fetcher.state === "idle" && result?.ok) {
      formRef.current?.reset();
      setInserted(null);
    }
  }, [fetcher.state, result]);

  function insert(markdown: string) {
    const body = document.getElementById(BODY_FIELD_ID) as HTMLTextAreaElement | null;
    if (!body) return;
    const at = body.selectionStart ?? body.value.length;
    const before = body.value.slice(0, at);
    const prefix = before && !before.endsWith("\n") ? "\n\n" : "";
    body.setRangeText(`${prefix}${markdown}\n`, at, body.selectionEnd ?? at, "end");
    body.dispatchEvent(new Event("input", { bubbles: true }));
    setInserted(markdown);
  }

  const errors = result && !result.ok ? Object.values(result.errors ?? {}).flat() : [];
  return (
    <section className="panel upload-panel" aria-labelledby="upload-title">
      <h2 id="upload-title">Images</h2>
      <p className="field-hint">PNG, JPEG, or WebP, up to 10 MiB. Alt text is required. Images show only where the body references them.</p>
      <fetcher.Form method="post" action="/editor/attachments" encType="multipart/form-data" ref={formRef}>
        <div className="field">
          <label htmlFor="upload-file">Image file</label>
          <input id="upload-file" name="file" type="file" accept="image/png,image/jpeg,image/webp" required />
        </div>
        <div className="field">
          <label htmlFor="upload-alt">Alt text</label>
          <input id="upload-alt" name="altText" type="text" required maxLength={500} aria-describedby="upload-alt-hint" />
          <p className="field-hint" id="upload-alt-hint">
            Describe the image for people who cannot see it.
          </p>
        </div>
        <button type="submit" className="button" disabled={busy}>
          {busy ? "Uploading…" : "Upload image"}
        </button>
      </fetcher.Form>
      <div role="status" aria-live="polite">
        {result?.ok ? (
          <div className="upload-result">
            <p>
              Uploaded. Markdown: <code>{result.markdown}</code>
            </p>
            <button type="button" className="button" onClick={() => insert(result.markdown)}>
              Insert into body
            </button>
            {inserted ? <p className="muted">Inserted into the body.</p> : null}
          </div>
        ) : null}
      </div>
      {result && !result.ok ? (
        <div className="notice notice--error" role="alert">
          <p>{result.message}</p>
          {errors.length ? (
            <ul>
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
