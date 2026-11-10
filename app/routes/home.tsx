import { Link } from "react-router";
import { PublicationList } from "../components/publication-list";
import { servicesContext } from "../context";
import { savedIdsFor } from "../reader.server";
import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "540 Daily" },
    { name: "description", content: "News and research, organized by category." },
  ];
}

/** The public dashboard: editor-chosen category panels, each with its five newest published items. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const layout = await services.homepage.layout();
  const latest = await services.publications.latestPerCategory(layout.map((c) => c.id));
  const panels = layout.map((category) => ({ category, items: latest.get(category.id) ?? [] }));
  const savedIds = await savedIdsFor(request, services, panels.flatMap((p) => p.items.map((i) => i.id)));
  return { panels, savedIds };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { panels, savedIds } = loaderData;
  const homepageEmpty = panels.every((p) => p.items.length === 0);
  return (
    <section aria-labelledby="page-title">
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
          <div className="panel-grid">
            {panels.map(({ category, items }) => (
              <section key={category.id} className="panel category-panel" aria-labelledby={`panel-${category.id}`}>
                <h2 id={`panel-${category.id}`} className="category-panel__title">
                  <Link to={`/categories/${category.slug}`}>{category.name}</Link>
                </h2>
                {items.length === 0 ? (
                  <p className="muted">Nothing published in {category.name} yet.</p>
                ) : (
                  <>
                    <PublicationList items={items} savedIds={savedIds} />
                    <p className="category-panel__more">
                      <Link to={`/categories/${category.slug}`}>
                        More in {category.name}
                        <span aria-hidden="true"> →</span>
                      </Link>
                    </p>
                  </>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
