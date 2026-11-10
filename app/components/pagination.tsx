import { Link } from "react-router";

/** Previous/next links that keep the current filters. Renders nothing when everything fits on one page. */
export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params,
  label = "Pages",
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  params?: URLSearchParams;
  label?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1 && page <= 1) return null;

  const hrefFor = (target: number) => {
    const next = new URLSearchParams(params);
    if (target <= 1) next.delete("page");
    else next.set("page", String(target));
    const query = next.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  return (
    <nav className="pagination" aria-label={label}>
      {page > 1 ? (
        <Link to={hrefFor(Math.min(page - 1, totalPages))} rel="prev" className="button">
          ← Previous page
        </Link>
      ) : (
        <span />
      )}
      <span className="pagination__status">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link to={hrefFor(page + 1)} rel="next" className="button">
          Next page →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
