import { Link } from "react-router";
import { CategoryRows, LeadReport } from "../components/category-rows";
import { servicesContext } from "../context";
import { savedIdsFor } from "../reader.server";
import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "540 Daily" },
    { name: "description", content: "News and research, organized by category." },
  ];
}

/**
 * The public dashboard: editor-chosen category panels, each with its five newest published items.
 * The newest report among them opens the page.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const layout = await services.homepage.layout();
  const latest = await services.publications.latestPerCategory(layout.map((c) => c.id));
  const panels = layout.map((category) => ({ category, items: latest.get(category.id) ?? [] }));
  const lead = newestReport(panels.flatMap((p) => p.items));
  const savedIds = await savedIdsFor(request, services, panels.flatMap((p) => p.items.map((i) => i.id)));
  return { panels, lead, savedIds };
}

function newestReport<T extends { type: string; publishedAt: Date | string | null }>(items: readonly T[]): T | null {
  let best: T | null = null;
  for (const item of items) {
    if (item.type !== "report" || !item.publishedAt) continue;
    if (!best || new Date(item.publishedAt) > new Date(best.publishedAt!)) best = item;
  }
  return best;
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { panels, lead, savedIds } = loaderData;
  const homepageEmpty = panels.every((p) => p.items.length === 0);
  return (
    <section aria-labelledby="page-title" className="home">
      <h1 id="page-title" className="visually-hidden">
        540 Daily
      </h1>
      {panels.length === 0 ? (
        <p className="notice muted">
          No categories are on the homepage yet. <Link to="/categories">Browse all categories</Link>.
        </p>
      ) : (
        <>
          {homepageEmpty ? (
            <p className="notice muted">
              Nothing is published in the homepage categories yet. <Link to="/categories">Browse all categories</Link>.
            </p>
          ) : null}
          {lead ? <LeadReport item={lead} /> : null}
          <CategoryRows panels={panels} savedIds={savedIds} emptyMessage={(name) => `Nothing published in ${name} yet.`} />
        </>
      )}
    </section>
  );
}
