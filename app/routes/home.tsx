import { data, Link } from "react-router";
import { arrangePanels } from "../../server/core/categories";
import { homeWindowLabel } from "../../server/core/preferences";
import { CategoryRows, LeadReport } from "../components/category-rows";
import { PublicationList } from "../components/publication-list";
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
 * The home page: a panel for every category with items published in the timeframe (24 hours unless a
 * member chose another), opened by the newest report among them. The editor-chosen public layout, or a
 * member's own saved panels, sets the preferred order; other categories with recent items follow,
 * newest first. A member's interest tags filter the items. With nothing recent, the newest items
 * site-wide are listed instead.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const viewer = await getViewer(request, services);
  const { panels: preferred, personal, interestTags, windowHours } = await homeLayout(services, viewer);
  const recent = await services.publications.recentPerCategory(
    windowHours,
    interestTags.map((t) => t.id),
  );
  const panels = arrangePanels(preferred, recent);
  const fallback = panels.length === 0 && interestTags.length === 0 ? await services.publications.newestPublished() : [];
  const lead = newestReport(panels.flatMap((p) => p.items));
  const items = [...panels.flatMap((p) => p.items), ...fallback];
  const savedIds = viewer ? [...(await services.bookmarks.savedAmong(viewer.userId, items.map((i) => i.id)))] : null;
  return data(
    {
      panels,
      fallback,
      lead,
      savedIds,
      signedIn: !!viewer,
      personal,
      windowLabel: homeWindowLabel(windowHours),
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
  const { panels, fallback, lead, savedIds, signedIn, personal, windowLabel, interestTags } = loaderData;
  const filtered = interestTags.length > 0;
  return (
    <section aria-labelledby="page-title" className="home">
      <h1 id="page-title" className="visually-hidden">
        540 Daily
      </h1>
      {signedIn ? (
        <p className="home-note">
          <span>
            {filtered
              ? `Last ${windowLabel}, only items tagged ${interestTags.map((t) => t.name).join(", ")}.`
              : personal
                ? `Last ${windowLabel}, in your own panel order.`
                : `Last ${windowLabel}.`}
          </span>{" "}
          <Link to="/settings#home-page">Customize</Link>
        </p>
      ) : null}
      {panels.length === 0 ? (
        <>
          <p className="notice muted">
            {filtered ? `Nothing matching your interests was published in the last ${windowLabel}.` : `Nothing was published in the last ${windowLabel}.`}{" "}
            <Link to="/categories">Browse all categories</Link>.
          </p>
          {fallback.length > 0 ? (
            <section aria-labelledby="newest-title" className="home-newest">
              <h2 id="newest-title">Most recent</h2>
              <PublicationList items={fallback} savedIds={savedIds} showCategory />
            </section>
          ) : null}
        </>
      ) : (
        <>
          {lead ? <LeadReport item={lead} /> : null}
          <CategoryRows panels={panels} savedIds={savedIds} emptyMessage={(name) => `Nothing recent in ${name}.`} />
        </>
      )}
    </section>
  );
}
