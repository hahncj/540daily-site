import { Link } from "react-router";
import { publicationPath, type PublicationListItem } from "../../server/core/publications";
import { formatDate, isoString } from "./format";
import { PublicationList } from "./publication-list";

type Item = Pick<PublicationListItem, "id" | "type" | "title" | "summary" | "publishedAt" | "category">;

export type CategoryRow = { category: { id: string; name: string; slug: string }; items: readonly Item[] };

/**
 * Category panels as full-width rows: the category name on the left, its newest items beside it.
 * A category with nothing in it gets one quiet line instead of an empty box.
 * Used by the home page, for both the public layout and a member's own panels.
 */
export function CategoryRows({
  panels,
  savedIds,
  emptyMessage,
}: {
  panels: readonly CategoryRow[];
  savedIds?: readonly string[] | null;
  emptyMessage: (categoryName: string) => string;
}) {
  return (
    <div className="category-rows">
      {panels.map(({ category, items }) => {
        const empty = items.length === 0;
        return (
          <section
            key={category.id}
            className={empty ? "category-row category-row--empty" : "category-row"}
            aria-labelledby={`panel-${category.id}`}
          >
            <header className="category-row__head">
              <h2 id={`panel-${category.id}`} className="category-panel__title">
                <Link to={`/categories/${category.slug}`}>{category.name}</Link>
              </h2>
              {empty ? null : (
                <p className="category-panel__more">
                  <Link to={`/categories/${category.slug}`}>More in {category.name}</Link>
                </p>
              )}
            </header>
            {empty ? (
              <p className="category-row__empty muted">{emptyMessage(category.name)}</p>
            ) : (
              <PublicationList items={items} savedIds={savedIds} className="category-row__items" />
            )}
          </section>
        );
      })}
    </div>
  );
}

/** The homepage's opening item: the newest report, shown large. */
export function LeadReport({ item }: { item: Item }) {
  return (
    <article className="lead-report" aria-labelledby="lead-report-title">
      <p className="lead-report__meta">
        <span className="type-label type-label--report">Latest report</span>
        {" in "}
        <Link to={`/categories/${item.category.slug}`}>{item.category.name}</Link>
        {item.publishedAt ? (
          <>
            {", "}
            <time dateTime={isoString(item.publishedAt)}>{formatDate(item.publishedAt)}</time>
          </>
        ) : null}
      </p>
      <h2 id="lead-report-title" className="lead-report__title">
        <Link to={publicationPath(item)}>{item.title}</Link>
      </h2>
      {item.summary ? <p className="lead-report__summary">{item.summary}</p> : null}
    </article>
  );
}
