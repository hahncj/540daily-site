import { Form, Link, redirect, useNavigation } from "react-router";
import { attribution, publicationPath } from "../../server/core/publications";
import { fail } from "../../server/core/result";
import { EditorNav, ErrorNotice, Flash, StatusBadge, Time, editorLinks, NOINDEX_META } from "../components/editor/shared";
import { PublicationForm } from "../components/editor/publication-form";
import { UploadPanel } from "../components/editor/upload-panel";
import { servicesContext } from "../context";
import type { Route } from "./+types/editor.publication";
import {
  failure,
  positiveInt,
  readPublicationForm,
  renderPreview,
  requireEditorPage,
  requireEditorWrite,
  toPublicationInput,
  valuesFromPublication,
} from "./editor.server";

export const links = editorLinks;

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData ? `Edit: ${loaderData.publication.title}` : "Edit publication"} · Editor · 540 Daily` }, NOINDEX_META];
}

const DONE_MESSAGES: Record<string, string> = {
  created: "Draft saved. It is visible only to editors until you publish it.",
  saved: "Changes saved.",
  published: "Published. It is now on the public site.",
  unpublished: "Unpublished. It is hidden from every public page, search, and feed.",
  restored: "Restored to public view.",
};

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const actor = await requireEditorPage(request, services);
  const publication = await services.publications.getForEditor(actor, params.id);
  if (!publication) throw new Response("Publication not found.", { status: 404 });
  const categories = await services.categories.listAll();
  const done = new URL(request.url).searchParams.get("done");
  return {
    publication,
    values: valuesFromPublication(publication),
    attribution: attribution(publication.createdBy),
    publicPath: publicationPath(publication),
    categories: categories.map((c) => c.name),
    flash: done ? (DONE_MESSAGES[done] ?? null) : null,
  };
}

const STATUS_INTENTS = {
  publish: { run: "publish", done: "published" },
  unpublish: { run: "unpublish", done: "unpublished" },
  "restore-visibility": { run: "restoreVisibility", done: "restored" },
} as const;

export async function action({ request, params, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  const actor = await requireEditorWrite(request, services);
  const id = params.id;
  const form = await request.formData();
  // "Save my version" after a conflict carries the revision the editor chose to save on top of.
  const override = positiveInt(form.get("overrideRevision"));
  const intent = override ? "save" : String(form.get("intent") ?? "save");
  const expectedRevision = override ?? positiveInt(form.get("expectedRevision"));
  const here = `/editor/publications/${encodeURIComponent(id)}`;

  if (intent in STATUS_INTENTS) {
    const { run, done } = STATUS_INTENTS[intent as keyof typeof STATUS_INTENTS];
    if (!expectedRevision) return failure(fail("invalid", "The form is missing its revision. Reload the page."), { intent, values: null, preview: null });
    const result = await services.publications[run](actor, id, expectedRevision);
    if (!result.ok) return failure(result, { intent, values: null, preview: null });
    throw redirect(`${here}?done=${done}`);
  }

  const values = readPublicationForm(form);
  if (intent === "preview") {
    return { ok: true as const, intent, values, expectedRevision, preview: await renderPreview(services, values.bodyMarkdown) };
  }
  if (!expectedRevision) return failure(fail("invalid", "The form is missing its revision. Reload the page."), { intent, values, preview: null, expectedRevision });
  const saved = await services.publications.update(actor, id, { expectedRevision, ...toPublicationInput(values) });
  if (!saved.ok) return failure(saved, { intent, values, preview: null, expectedRevision });
  if (intent === "save-publish" && saved.value.status === "draft") {
    const published = await services.publications.publish(actor, id, saved.value.revision);
    // The save went through; only publishing failed. Show the saved page with the reason.
    if (!published.ok) return failure(published, { intent, values: null, preview: null, expectedRevision: null });
    throw redirect(`${here}?done=published`);
  }
  throw redirect(`${here}?done=saved`);
}

export default function EditPublication({ loaderData, actionData }: Route.ComponentProps) {
  const p = loaderData.publication;
  const formFailed = actionData && !actionData.ok && actionData.values;
  // After a failed save or a preview, the form keeps the submitted values and the revision it was based on.
  const values = actionData?.values ?? loaderData.values;
  const expectedRevision = (actionData && "expectedRevision" in actionData && actionData.expectedRevision) || p.revision;
  const conflictRevision = actionData && !actionData.ok && actionData.values ? actionData.currentRevision : null;
  const preview = actionData?.ok ? actionData.preview : null;
  const here = `/editor/publications/${encodeURIComponent(p.id)}`;
  return (
    <section aria-labelledby="page-title" className="editor">
      <EditorNav />
      <h1 id="page-title">Edit publication</h1>
      <Flash message={actionData ? null : loaderData.flash} />
      <ErrorNotice message={actionData && !actionData.ok ? actionData.message + (formFailed ? " Your input is kept below." : "") : null} />

      <dl className="publication-facts">
        <div>
          <dt>Status</dt>
          <dd>
            <StatusBadge status={p.status} />
          </dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd>{p.revision}</dd>
        </div>
        <div>
          <dt>Created by</dt>
          <dd>{loaderData.attribution}</dd>
        </div>
        <div>
          <dt>Published</dt>
          <dd>{p.publishedAt ? <Time value={p.publishedAt} /> : "Not yet"}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>
            <Time value={p.updatedAt} />
          </dd>
        </div>
      </dl>
      <p className="link-row">
        <Link to={`${here}/history`}>History and restore</Link>
        {p.status === "published" ? <Link to={loaderData.publicPath}>View public page</Link> : null}
      </p>

      <VisibilityControls status={p.status} revision={p.revision} />

      <PublicationForm
        key={`${p.id}:${expectedRevision}`}
        mode="edit"
        status={p.status}
        values={values}
        errors={actionData && !actionData.ok ? actionData.errors : {}}
        categories={loaderData.categories}
        expectedRevision={expectedRevision}
        conflictRevision={conflictRevision}
        historyHref={`${here}/history`}
        previewHtml={preview && "html" in preview ? preview.html : null}
        previewError={preview && "error" in preview ? preview.error : null}
      />
      <UploadPanel />
    </section>
  );
}

function VisibilityControls({ status, revision }: { status: "draft" | "published" | "unpublished"; revision: number }) {
  const busy = useNavigation().state === "submitting";
  const action =
    status === "draft"
      ? { intent: "publish", label: "Publish", hint: "Publishing puts the last saved version on the public site." }
      : status === "published"
        ? { intent: "unpublish", label: "Unpublish", hint: "Unpublishing hides it from every public page, search, feed, and attachment link. Nothing is deleted." }
        : { intent: "restore-visibility", label: "Restore to public view", hint: "Restoring keeps the original publication time." };
  return (
    <section className="panel visibility" aria-labelledby="visibility-title">
      <h2 id="visibility-title">Visibility</h2>
      <p className="field-hint" id="visibility-hint">
        {action.hint} Save any edits below first.
      </p>
      <Form method="post">
        <input type="hidden" name="expectedRevision" value={revision} />
        <button type="submit" className="button" name="intent" value={action.intent} disabled={busy} aria-describedby="visibility-hint">
          {action.label}
        </button>
      </Form>
    </section>
  );
}
