import { data, Link } from "react-router";
import { PANEL_SIZE } from "../../server/core/publications";
import { CategoryRows, LeadReport } from "../components/category-rows";
import { servicesContext } from "../context";
import { homeLayout } from "../home.server";
import { getViewer } from "../session.server";
import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "540 Daily" },
    { name: "description", content: "News and research, organized by category." },
  ];
}

/** A signed-in member's home page is their own: never let a shared cache keep it. */
export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

/**
 * The home page: category panels, each with its newest published items, opened by the newest report
 * among them. Visitors see the editor-chosen public layout. Signed-in members see their own saved
 * layout if they have one, filtered by their interest tags.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const viewer = await getViewer(request, services);
  const { panels: layout, personal, interestTags } = await homeLayout(services, viewer);
  const latest = await services.publications.latestPerCategory(
    layout.map((c) => c.id),
    PANEL_SIZE,
    interestTags.map((t) => t.id),
  );
  const panels = layout.map((category) => ({ category, items: latest.get(category.id) ?? [] }));
  const items = panels.flatMap((p) => p.items);
  const lead = newestReport(items);
  const savedIds = viewer ? [...(await services.bookmarks.savedAmong(viewer.userId, items.map((i) => i.id)))] : null;
  return data(
    {
      panels,
      lead,
      savedIds,
      signedIn: !!viewer,
      personal,
      interestTags: interestTags.map(({ id, name }) => ({ id, name })),
    },
    viewer ? { headers: { "Cache-Control": "private, no-store" } } : undefined,
  );
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
  const { panels, lead, savedIds, signedIn, personal, interestTags } = loaderData;
  const filtered = interestTags.length > 0;
  const allEmpty = panels.every((p) => p.items.length === 0);
  return (
    <section aria-labelledby="page-title" className="home">
      <h1 id="page-title" className="visually-hidden">
        540 Daily
      </h1>
      {signedIn ? (
        <p className="home-note">
          <span>
            {filtered
              ? `Showing only items tagged ${interestTags.map((t) => t.name).join(", ")}.`
              : personal
                ? "Your own panels."
                : "The public layout."}
          </span>{" "}
          <Link to="/settings#home-page">Customize</Link>
        </p>
      ) : null}
      {panels.length === 0 ? (
        <p className="notice muted">
          {personal ? (
            <>
              Your home page has no panels. <Link to="/settings#home-page">Add a category</Link>.
            </>
          ) : (
            <>
              No categories are on the homepage yet. <Link to="/categories">Browse all categories</Link>.
            </>
          )}
        </p>
      ) : (
        <>
          {allEmpty && !filtered ? (
            <p className="notice muted">
              Nothing is published in these categories yet. <Link to="/categories">Browse all categories</Link>.
            </p>
          ) : null}
          {lead ? <LeadReport item={lead} /> : null}
          <CategoryRows
            panels={panels}
            savedIds={savedIds}
            emptyMessage={(name) => (filtered ? `Nothing in ${name} matches your interests yet.` : `Nothing published in ${name} yet.`)}
          />
        </>
      )}
    </section>
  );
}
