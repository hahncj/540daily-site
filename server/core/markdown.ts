// Markdown rules shared by every surface. The renderer itself (markdown-it + xss) lives in
// server/adapters/markdown.ts; core only defines its interface and the pure reference helpers.

/** An attachment the renderer may show inline: it must belong to the publication version being rendered. */
export type RenderableAttachment = { id: string; altText: string };

export interface MarkdownRenderer {
  /**
   * Untrusted Markdown → sanitized HTML. Raw HTML is shown as text; links allow only http, https, and
   * mailto; images render only as `attachment:ID` references whose ID is in `attachments`, rewritten
   * to `/attachments/ID`. Every other image is dropped. The editor preview and public pages use this.
   */
  render(markdown: string, options?: { attachments?: readonly RenderableAttachment[] }): string;
  /**
   * IDs used as `attachment:ID` image sources or link targets, in first-seen order. Parsed, so text and
   * code that merely mention the syntax do not count. Used to validate a publication's attachments.
   */
  attachmentRefs(markdown: string | null | undefined): string[];
}

/** The Markdown syntax agents and editors use for an uploaded image. */
export const ATTACHMENT_SCHEME = "attachment:";

/** Attachment IDs are server-generated UUIDs (or test IDs); keep the accepted alphabet narrow. */
export const ATTACHMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function attachmentPath(id: string): string {
  return `/attachments/${encodeURIComponent(id)}`;
}
