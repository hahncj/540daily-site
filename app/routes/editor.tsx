import { Form, Link } from "react-router";
import { attribution, PUBLICATION_STATUSES, type PublicationStatus } from "../../server/core/publications";
import { EditorNav, StatusBadge, Time, editorLinks, NOINDEX_META } from "../components/editor/shared";
import { servicesContext } from "../context";
import type { Route } from "./+types/editor";
import { positiveInt, requireEditorPage } from "./editor.server";

export const links = editorLinks;

export function meta(_: Route.MetaArgs) {
  return [{ title: "Editor · 540 Daily" }, NOINDEX_META];
}

const FILTERS: Array<{ value: "" | PublicationStatus; label: string }> = [
  { value: "", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "published", label: "Published" },
  { value: "unpublished", label: "Unpublished" },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const actor = await requireEditorPage(request, services);
  const search = new URL(request.url).searchParams;
  const rawStatus = search.get("status") ?? "";
  const status = (PUBLICATION_STATUSES as readonly string[]).includes(rawStatus) ? (rawStatus as PublicationStatus) : undefined;
  const result = await services.publications.listForEditor(actor, { status, page: positiveInt(search.get("page")) ?? 1 });
  if (!result.ok) throw new Response(result.message, { status: 403 });
  const { items, total, page, pageSize } = result.value;
  return {
    status: status ?? "",
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    total,
    items: items.map((p) => ({
      id: p.id,
      title: p.title,
      type: p.type,
      status: p.status,
      category: p.category.name,
      revision: p.revision,
      by: attribution(p.createdBy),
      updatedAt: p.updatedAt,
    })),
  };
}

export default function EditorIndex({ loaderData }: Route.ComponentProps) {
  const { items, status, page, pageCount, total } = loaderData;
  const pageHref = (n: number) => `?${new URLSearchParams({ ...(status ? { status } : {}), page: String(n) })}`;
  return (
    <section aria-labelledby="page-title" className="editor">
      <EditorNav />
      <div className="editor-heading">
        <h1 id="page-title">Publications</h1>
        <Link to="/editor/new" className="button button--primary">
          New publication
        </Link>
      </div>

      <Form method="get" className="filter-row" aria-label="Filter publications">
        <label htmlFor="status-filter">Show</label>
        <select id="status-filter" name="status" defaultValue={status} key={status}>
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <button type="submit" className="button">
          Filter
        </button>
      </Form>

      <p className="muted" role="status">
        {total === 0 ? "No publications match." : `${total} publication${total === 1 ? "" : "s"}, newest activity first.`}
      </p>
      {total === 0 && !status ? (
        <p className="notice">
          Nothing has been published yet. <Link to="/editor/new">Write the first publication</Link>, or connect an agent from your account page.
        </p>
      ) : null}

      <ul className="publication-list">
        {items.map((p) => (
          <li key={p.id} className="panel">
            <h2 className="publication-list__title">
              <Link to={`/editor/publications/${encodeURIComponent(p.id)}`}>{p.title}</Link>
            </h2>
            <p className="publication-list__meta">
              <StatusBadge status={p.status} /> <span>{p.type === "story" ? "Story" : "Report"}</span> · <span>{p.category}</span> · <span>{p.by}</span> · revision {p.revision} · updated{" "}
              <Time value={p.updatedAt} />
            </p>
          </li>
        ))}
      </ul>

      {pageCount > 1 ? (
        <nav className="pagination" aria-label="Pages">
          {page > 1 ? <Link to={pageHref(page - 1)}>Previous page</Link> : null}
          <span>
            Page {page} of {pageCount}
          </span>
          {page < pageCount ? <Link to={pageHref(page + 1)}>Next page</Link> : null}
        </nav>
      ) : null}
    </section>
  );
}
