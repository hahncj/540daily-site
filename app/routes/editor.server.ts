// Server helpers shared by the editor routes. Every editor loader and action starts with one of the
// guards below, so editor pages are editor/owner only on the server, whatever the UI shows.
import { data } from "react-router";
import type { Services } from "../../server/app";
import type { MemberActor } from "../../server/core/actors";
import { LIMITS, type Publication, type PublicationContent } from "../../server/core/publications";
import { HTTP_STATUS, type Failure, type FieldErrors } from "../../server/core/result";
import { requireRolePage, requireRoleWrite } from "../access.server";

/** GET pages: signed-out visitors go to sign-in; readers get 403. */
export async function requireEditorPage(request: Request, services: Services): Promise<MemberActor> {
  const viewer = await requireRolePage(request, services, "editor");
  return { kind: "member", userId: viewer.userId, role: viewer.role };
}

/** Actions: same-origin check, then editor or owner. 401 signed out, 403 otherwise. */
export async function requireEditorWrite(request: Request, services: Services): Promise<MemberActor> {
  const viewer = await requireRoleWrite(request, services, "editor");
  return { kind: "member", userId: viewer.userId, role: viewer.role };
}

/** Raw form values, echoed back on failure so a failed save keeps the editor's input. */
export type PublicationFormValues = {
  type: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  category: string;
  tags: string;
  sources: string;
  sourcePublishedAt: string;
};

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

export function readPublicationForm(form: FormData): PublicationFormValues {
  return {
    type: text(form, "type"),
    title: text(form, "title"),
    summary: text(form, "summary"),
    bodyMarkdown: text(form, "bodyMarkdown").replace(/\r\n/g, "\n"),
    category: text(form, "category"),
    tags: text(form, "tags"),
    sources: text(form, "sources").replace(/\r\n/g, "\n"),
    sourcePublishedAt: text(form, "sourcePublishedAt").trim(),
  };
}

/** Comma-separated tags. */
export function splitTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** One source per line: the link first, then an optional label. */
export function parseSources(raw: string): Array<{ url: string; label?: string }> {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [url = "", ...rest] = line.split(/\s+/);
      const label = rest.join(" ").trim();
      return label ? { url, label } : { url };
    });
}

/** Form values → the core create/update input. Core validates everything. */
export function toPublicationInput(values: PublicationFormValues) {
  return {
    type: values.type,
    title: values.title,
    summary: values.summary,
    bodyMarkdown: values.bodyMarkdown.trim() ? values.bodyMarkdown : null,
    category: values.category,
    tags: splitTags(values.tags),
    sources: parseSources(values.sources),
    sourcePublishedAt: values.sourcePublishedAt || null,
  };
}

function dateOnly(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export function valuesFromContent(c: Pick<PublicationContent, "type" | "title" | "summary" | "bodyMarkdown" | "tags" | "sources" | "sourcePublishedAt"> & { category: string }): PublicationFormValues {
  return {
    type: c.type,
    title: c.title,
    summary: c.summary,
    bodyMarkdown: c.bodyMarkdown ?? "",
    category: c.category,
    tags: c.tags.join(", "),
    sources: c.sources.map((s) => (s.label ? `${s.url} ${s.label}` : s.url)).join("\n"),
    sourcePublishedAt: dateOnly(c.sourcePublishedAt),
  };
}

export function valuesFromPublication(p: Publication): PublicationFormValues {
  return valuesFromContent({ ...p, category: p.category.name, tags: p.tags.map((t) => t.name) });
}

/** Group core field errors (`sources.0.url`, `tags.2`) under the form field that shows them. */
export function formErrors(errors: FieldErrors | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [path, messages] of Object.entries(errors ?? {})) {
    const [raw = "_", index] = path.split(".");
    // Attachments come from the body's references, so their errors belong to the body field.
    const field = raw === "attachmentIds" ? "bodyMarkdown" : raw;
    const prefix = index !== undefined && /^\d+$/.test(index) ? `${field === "sources" ? "Source" : "Tag"} ${Number(index) + 1}: ` : "";
    (out[field] ??= []).push(...messages.map((m) => prefix + m));
  }
  return out;
}

/** An action failure as a `data()` response with the matching HTTP status. */
export function failure<T extends object>(result: Failure, extra: T) {
  return data(
    { ok: false as const, message: result.message, errors: formErrors(result.errors), currentRevision: result.currentRevision ?? null, ...extra },
    { status: HTTP_STATUS[result.status] },
  );
}

/** Preview through the one public renderer. Attachments are the ones the Markdown references. */
export async function renderPreview(services: Services, bodyMarkdown: string): Promise<{ html: string } | { error: string }> {
  if (bodyMarkdown.length > LIMITS.body) return { error: `The body can be at most ${LIMITS.body} characters.` };
  const html = await services.publications.renderBody({ bodyMarkdown, attachmentIds: services.markdown.attachmentRefs(bodyMarkdown) });
  return { html };
}

export function positiveInt(value: FormDataEntryValue | string | null): number | null {
  if (typeof value !== "string" || !/^\d{1,9}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 ? n : null;
}
