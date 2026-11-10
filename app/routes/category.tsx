import { Link } from "react-router";
import { PUBLICATION_TYPES, type PublicationType } from "../../server/core/publications";
import { pageParam, TYPE_PLURAL } from "../components/format";
import { Pagination } from "../components/pagination";
import { PublicationList } from "../components/publication-list";
import { servicesContext } from "../context";
import { savedIdsFor } from "../reader.server";
import type { Route } from "./+types/category";

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not found · 540 Daily" }];
  const name = loaderData.category.name;
  return [
    { title: `${name} · 540 Daily` },
    { name: "description", content: `${name} stories and reports on 540 Daily, newest first.` },
  ];
}

/**
 * One category's published items, newest first, 20 per page, with an optional type filter.
 * A category is public once it has published content or an editor put it on the homepage;
 * otherwise it is "not found", so a category used only by unpublished items does not leak.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const category = await services.categories.getBySlug(params.slug);
  if (!category) throw new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const typeValue = url.searchParams.get("type");
  const type = PUBLICATION_TYPES.includes(typeValue as PublicationType) ? (typeValue as PublicationType) : undefined;
  const page = pageParam(url.searchParams.get("page"));

  const results = await services.publications.listPublished({ categoryId: category.id, type, page });
  if (results.total === 0) {
    // Nothing matched: the category may still be public through other types or the homepage layout.
    const [withPublished, layout] = await Promise.all([services.categories.listWithPublished(), services.homepage.layout()]);
    const isPublic = withPublished.some((c) => c.id === category.id) || layout.some((c) => c.id === category.id);
    if (!isPublic) throw new Response("Not found", { status: 404 });
  }

  const savedIds = await savedIdsFor(request, services, results.items.map((i) => i.id));
  return { category, type: type ?? null, results, savedIds };
}

export default function Category({ loaderData }: Route.ComponentProps) {
  const { category, type, results, savedIds } = loaderData;
  const base = `/categories/${category.slug}`;
  const params = new URLSearchParams(type ? { type } : {});
  const filters: Array<{ value: PublicationType | null; label: string }> = [
    { value: null, label: "All" },
    ...PUBLICATION_TYPES.map((t) => ({ value: t, label: TYPE_PLURAL[t] })),
  ];
  const beyondLastPage = results.items.length === 0 && results.total > 0;

  return (
    <section aria-labelledby="page-title">
      <p className="breadcrumb">
        <Link to="/categories">Categories</Link>
      </p>
      <h1 id="page-title">{category.name}</h1>
      <nav aria-label="Publication type" className="filter-tabs">
        <ul>
          {filters.map((f) => (
            <li key={f.label}>
              <Link to={f.value ? `${base}?type=${f.value}` : base} aria-current={f.value === type ? "page" : undefined}>
                {f.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {results.total === 0 ? (
        <p className="notice muted">
          {type ? `No ${TYPE_PLURAL[type].toLowerCase()} in ${category.name} yet.` : `Nothing published in ${category.name} yet.`}
        </p>
      ) : beyondLastPage ? (
        <p className="notice muted">
          There are no more results. <Link to={type ? `${base}?type=${type}` : base}>Go to the first page</Link>.
        </p>
      ) : (
        <PublicationList items={results.items} headingLevel={2} savedIds={savedIds} />
      )}
      <Pagination page={results.page} pageSize={results.pageSize} total={results.total} basePath={base} params={params} />
    </section>
  );
}
