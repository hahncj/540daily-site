// Safe Markdown renderer: markdown-it with raw HTML off, a link-protocol allowlist, `attachment:ID`
// image rewriting, then an explicit xss (js-xss) tag/attribute allowlist as defense in depth.
// The same renderer serves the editor preview and public pages.
import MarkdownIt from "markdown-it";
import xssDefault from "xss";
import { ATTACHMENT_ID_PATTERN, ATTACHMENT_SCHEME, attachmentPath, type MarkdownRenderer, type RenderableAttachment } from "../core/markdown";

// xss is CommonJS: its default export is module.exports, which carries FilterXSS and safeAttrValue.
const xss = xssDefault as unknown as typeof import("xss");

type Env = { attachments: Map<string, RenderableAttachment>; collectOnly?: boolean };

const LINK_PROTOCOL = /^(https?:|mailto:)/i;
const ATTACHMENT_SRC = /^\/attachments\/[A-Za-z0-9_-]{1,64}$/;
const LINK_REL = "nofollow noopener noreferrer ugc";

function attachmentIdOf(url: string | null): string | null {
  if (!url || !url.toLowerCase().startsWith(ATTACHMENT_SCHEME)) return null;
  const id = url.slice(ATTACHMENT_SCHEME.length);
  return ATTACHMENT_ID_PATTERN.test(id) ? id : null;
}

function createParser() {
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

  // Only http, https, mailto links, and attachment: references survive parsing.
  md.validateLink = (url) => {
    const v = url.trim();
    return LINK_PROTOCOL.test(v) || attachmentIdOf(v) !== null;
  };

  // After inline parsing: rewrite allowed attachment links; turn every other unsafe link into plain text.
  md.core.ruler.push("app_safe_links", (state) => {
    const env = state.env as Env;
    for (const block of state.tokens) {
      if (block.type !== "inline" || !block.children) continue;
      const stack: boolean[] = [];
      for (const t of block.children) {
        if (t.type === "link_open") {
          const href = String(t.attrGet("href") ?? "");
          if (env.collectOnly) {
            stack.push(true);
            continue;
          }
          const id = attachmentIdOf(href);
          let keep = LINK_PROTOCOL.test(href.trim());
          if (id) {
            keep = env.attachments.has(id);
            if (keep) t.attrSet("href", attachmentPath(id));
          }
          if (keep) t.attrSet("rel", LINK_REL);
          else {
            t.type = "text";
            t.tag = "";
            t.attrs = null;
            t.content = "";
          }
          stack.push(keep);
        } else if (t.type === "link_close") {
          if (stack.pop() === false) {
            t.type = "text";
            t.tag = "";
            t.content = "";
          }
        }
      }
    }
  });

  // Images: only `attachment:ID` for an attachment of this publication version. Everything else is dropped.
  md.renderer.rules.image = (tokens, idx, options, rawEnv, self) => {
    const env = rawEnv as Env | undefined;
    const token = tokens[idx]!;
    const id = attachmentIdOf(String(token.attrGet("src") ?? ""));
    const attachment = id ? env?.attachments.get(id) : undefined;
    if (!attachment) return "";
    const written = self.renderInlineAsText(token.children ?? [], options, env).trim();
    const alt = md.utils.escapeHtml(written || attachment.altText);
    const title = token.attrGet("title");
    return `<img src="${attachmentPath(attachment.id)}" alt="${alt}"${title ? ` title="${md.utils.escapeHtml(String(title))}"` : ""} loading="lazy">`;
  };

  return md;
}

const ALLOWED_TAGS: Record<string, string[]> = {
  a: ["href", "title", "rel"],
  img: ["src", "alt", "title", "loading"],
  p: [],
  br: [],
  hr: [],
  h1: [],
  h2: [],
  h3: [],
  h4: [],
  h5: [],
  h6: [],
  strong: [],
  em: [],
  s: [],
  del: [],
  code: [],
  pre: [],
  blockquote: [],
  ul: [],
  ol: ["start"],
  li: [],
  table: [],
  thead: [],
  tbody: [],
  tr: [],
  th: [],
  td: [],
};

type XssCssFilter = Parameters<typeof xss.safeAttrValue>[3];

const sanitizer = new xss.FilterXSS({
  whiteList: ALLOWED_TAGS,
  stripIgnoreTag: true,
  stripIgnoreTagBody: ["script", "style", "iframe", "object", "embed"],
  allowCommentTag: false,
  css: false,
  safeAttrValue(tag: string, name: string, value: string, cssFilter: XssCssFilter) {
    if (tag === "img" && name === "src") return ATTACHMENT_SRC.test(value) ? value : "";
    if (tag === "a" && name === "href") return LINK_PROTOCOL.test(value) || ATTACHMENT_SRC.test(value) ? xss.safeAttrValue(tag, name, value, cssFilter) : "";
    if (tag === "a" && name === "rel") return LINK_REL;
    if (tag === "img" && name === "loading") return "lazy";
    return xss.safeAttrValue(tag, name, value, cssFilter);
  },
});

export function createMarkdownRenderer(): MarkdownRenderer {
  const md = createParser();
  return {
    render(markdown, options = {}) {
      const env: Env = { attachments: new Map((options.attachments ?? []).map((a) => [a.id, a])) };
      return sanitizer.process(md.render(markdown, env));
    },
    attachmentRefs(markdown) {
      if (!markdown) return [];
      const ids = new Set<string>();
      // Parse with every attachment allowed, so link tokens keep their attachment: targets.
      const env: Env = { attachments: new Map(), collectOnly: true };
      for (const block of md.parse(markdown, env)) {
        for (const t of block.children ?? []) {
          const url = t.type === "image" ? t.attrGet("src") : t.type === "link_open" ? t.attrGet("href") : null;
          const id = attachmentIdOf(String(url ?? ""));
          if (id) ids.add(id);
        }
      }
      return [...ids];
    },
  };
}
