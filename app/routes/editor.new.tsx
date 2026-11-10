import { redirect } from "react-router";
import { EditorNav, ErrorNotice, editorLinks, NOINDEX_META } from "../components/editor/shared";
import { PublicationForm } from "../components/editor/publication-form";
import { UploadPanel } from "../components/editor/upload-panel";
import { servicesContext } from "../context";
import type { Route } from "./+types/editor.new";
import { failure, readPublicationForm, renderPreview, requireEditorPage, requireEditorWrite, toPublicationInput, type PublicationFormValues } from "./editor.server";

export const links = editorLinks;

export function meta(_: Route.MetaArgs) {
  return [{ title: "New publication · Editor · 540 Daily" }, NOINDEX_META];
}

const EMPTY: PublicationFormValues = { type: "story", title: "", summary: "", bodyMarkdown: "", category: "", tags: "", sources: "", sourcePublishedAt: "" };

export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  await requireEditorPage(request, services);
  const categories = await services.categories.listAll();
  return { categories: categories.map((c) => c.name) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  const actor = await requireEditorWrite(request, services);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "save");
  const values = readPublicationForm(form);

  if (intent === "preview") {
    return { ok: true as const, values, preview: await renderPreview(services, values.bodyMarkdown) };
  }
  const result = await services.publications.create(actor, toPublicationInput(values), { publish: intent === "publish" });
  if (!result.ok) return failure(result, { values, preview: null });
  const p = result.value.publication;
  throw redirect(`/editor/publications/${encodeURIComponent(p.id)}?done=${p.status === "published" ? "published" : "created"}`);
}

export default function NewPublication({ loaderData, actionData }: Route.ComponentProps) {
  const errors = actionData && !actionData.ok ? actionData.errors : {};
  const preview = actionData?.preview ?? null;
  return (
    <section aria-labelledby="page-title" className="editor">
      <EditorNav />
      <h1 id="page-title">New publication</h1>
      <p className="muted">Save a private draft, or publish now. Drafts are visible only to editors.</p>
      <ErrorNotice message={actionData && !actionData.ok ? `${actionData.message} Your input is kept; fix it and try again.` : null} />
      <PublicationForm
        mode="new"
        values={actionData?.values ?? EMPTY}
        errors={errors}
        categories={loaderData.categories}
        previewHtml={preview && "html" in preview ? preview.html : null}
        previewError={preview && "error" in preview ? preview.error : null}
      />
      <UploadPanel />
    </section>
  );
}
