import { Link } from "react-router";
import { servicesContext } from "../context";
import type { Route } from "./+types/categories";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Categories · 540 Daily" },
    { name: "description", content: "Every 540 Daily category with published stories and reports." },
  ];
}

/** Every category with published content, including those not on the homepage. Counts are published items only. */
export async function loader({ context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  return { categories: await services.categories.listWithPublished() };
}

export default function Categories({ loaderData }: Route.ComponentProps) {
  const { categories } = loaderData;
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title">Categories</h1>
      {categories.length === 0 ? (
        <p className="notice muted">No categories have published content yet.</p>
      ) : (
        <ul className="category-directory">
          {categories.map((c) => (
            <li key={c.id}>
              <Link to={`/categories/${c.slug}`}>{c.name}</Link>{" "}
              <span className="muted">
                ({c.publishedCount} {c.publishedCount === 1 ? "publication" : "publications"})
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
