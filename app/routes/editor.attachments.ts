// Editor image upload (POST /editor/attachments, multipart). Runs the same core upload rules agents use:
// prepare a ticket for this member, then complete it with the bytes (size and signature checked in core).
import { data } from "react-router";
import { MAX_ATTACHMENT_BYTES, sniffImageType } from "../../server/core/attachments";
import { HTTP_STATUS } from "../../server/core/result";
import { servicesContext } from "../context";
import type { Route } from "./+types/editor.attachments";
import { formErrors, requireEditorWrite } from "./editor.server";

/** Room for the multipart envelope and the alt text around a maximum-size file. */
const MAX_REQUEST_BYTES = MAX_ATTACHMENT_BYTES + 64 * 1024;

const markdownAlt = (alt: string) => alt.replace(/[\\[\]]/g, (c) => `\\${c}`).replace(/\s+/g, " ");

export async function loader() {
  throw new Response("Not found.", { status: 404 });
}

export async function action({ request, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  const actor = await requireEditorWrite(request, services);
  // Browsers always send a length for form uploads; without one the body could be any size.
  const declared = Number(request.headers.get("Content-Length") ?? "NaN");
  if (!Number.isFinite(declared)) return data({ ok: false as const, message: "The upload has no length. Try again from the editor page." }, { status: 411 });
  if (declared > MAX_REQUEST_BYTES) return data({ ok: false as const, message: "Images can be at most 10 MiB." }, { status: 413 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return data({ ok: false as const, message: "The upload could not be read. Try again." }, { status: 400 });
  }
  const file = form.get("file");
  const altText = typeof form.get("altText") === "string" ? String(form.get("altText")) : "";
  if (!(file instanceof File) || file.size === 0) return data({ ok: false as const, message: "Choose an image file." }, { status: 422 });
  if (file.size > MAX_ATTACHMENT_BYTES) return data({ ok: false as const, message: "Images can be at most 10 MiB." }, { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  // The declared type comes from the file's own bytes when they are a known image; core checks again.
  const mimeType = sniffImageType(bytes) ?? file.type;
  const ticket = await services.attachments.prepareUpload(actor, { mimeType, size: bytes.byteLength, altText });
  if (!ticket.ok) {
    const message = ticket.errors?.mimeType ? "Only PNG, JPEG, and WebP images are accepted." : ticket.message;
    return data({ ok: false as const, message, errors: formErrors(ticket.errors) }, { status: HTTP_STATUS[ticket.status] });
  }
  const done = await services.attachments.completeUpload(ticket.value.token, bytes);
  if (!done.ok) return data({ ok: false as const, message: done.message }, { status: HTTP_STATUS[done.status] });
  const id = ticket.value.attachmentId;
  return { ok: true as const, attachment: { id, altText: done.value.altText }, markdown: `![${markdownAlt(done.value.altText)}](attachment:${id})` };
}
