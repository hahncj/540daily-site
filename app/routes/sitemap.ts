import { publicationPath } from "../../server/core/publications";
import { servicesContext } from "../context";
import type { Route } from "./+types/sitemap";

/**
 * Newest published publications listed. Each page of the core list is 20 items, so this bounds the
 * database work per sitemap request. A sitemap index for a larger archive is a later follow-up.
 */
export const SITEMAP_MAX_PUBLICATIONS = 1000;

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
const escapeXml = (value: string) => value.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!);

/** Only published public URLs: the homepage, the directory, categories with published content, and published items. */
export async function loader({ context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const { baseUrl } = services.config;
  const entries: Array<{ loc: string; lastmod?: Date }> = [{ loc: `${baseUrl}/` }, { loc: `${baseUrl}/categories` }];

  const newestPublications = async () => {
    const out: typeof entries = [];
    for (let page = 1, seen = 0; out.length < SITEMAP_MAX_PUBLICATIONS; page++) {
      const { items, total } = await services.publications.listPublished({ page });
      for (const p of items.slice(0, SITEMAP_MAX_PUBLICATIONS - out.length)) out.push({ loc: `${baseUrl}${publicationPath(p)}`, lastmod: p.updatedAt });
      seen += items.length;
      if (items.length === 0 || seen >= total) break;
    }
    return out;
  };
  const [categories, publications] = await Promise.all([services.categories.listWithPublished(), newestPublications()]);
  for (const c of categories) entries.push({ loc: `${baseUrl}/categories/${c.slug}` });
  entries.push(...publications);

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries
      .map((e) => `  <url><loc>${escapeXml(e.loc)}</loc>${e.lastmod ? `<lastmod>${new Date(e.lastmod).toISOString()}</lastmod>` : ""}</url>`)
      .join("\n") +
    `\n</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
