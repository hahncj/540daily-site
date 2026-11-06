import { servicesContext } from "../context";
import type { Route } from "./+types/sitemap";

// Only published public URLs belong here. Lane 2B adds categories and publications with content.
export async function loader({ context }: Route.LoaderArgs) {
  const { baseUrl } = context.get(servicesContext).config;
  const urls = [`${baseUrl}/`, `${baseUrl}/categories`];
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n") +
    `\n</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
