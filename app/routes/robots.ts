import { servicesContext } from "../context";
import type { Route } from "./+types/robots";

/**
 * Public pages are open to crawlers. Private pages carry `X-Robots-Tag: noindex` (set in handleRequest)
 * instead of a Disallow here, because a crawler must fetch a page to see its noindex header.
 * Only the machine endpoints, which are never pages, are disallowed.
 */
export async function loader({ context }: Route.LoaderArgs) {
  const { baseUrl } = context.get(servicesContext).config;
  const body = ["User-agent: *", "Disallow: /api/", "Disallow: /mcp", "Allow: /", "", `Sitemap: ${baseUrl}/sitemap.xml`, ""].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
