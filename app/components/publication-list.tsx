import { Link } from "react-router";
import { publicationPath, type PublicationListItem } from "../../server/core/publications";
import { formatDate, isoString, previewSummary, TYPE_LABEL } from "./format";

type ListItem = Pick<PublicationListItem, "id" | "type" | "title" | "summary" | "publishedAt" | "category">;

/** Headline, type label, date, and up to 240 characters of summary for each item. */
export function PublicationList({
  items,
  headingLevel = 3,
  showCategory = false,
  className,
}: {
  items: readonly ListItem[];
  headingLevel?: 2 | 3;
  showCategory?: boolean;
  className?: string;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <ul className={["publication-list", className].filter(Boolean).join(" ")}>
      {items.map((item) => (
        <li key={item.id} className="publication-item">
          <Heading className="publication-item__title">
            <Link to={publicationPath(item)}>{item.title}</Link>
          </Heading>
          <p className="publication-item__meta">
            <span className={`type-label type-label--${item.type}`}>{TYPE_LABEL[item.type]}</span>
            {item.publishedAt ? (
              <>
                {" · "}
                <time dateTime={isoString(item.publishedAt)}>{formatDate(item.publishedAt)}</time>
              </>
            ) : null}
            {showCategory ? (
              <>
                {" · "}
                <Link to={`/categories/${item.category.slug}`}>{item.category.name}</Link>
              </>
            ) : null}
          </p>
          <p className="publication-item__summary">{previewSummary(item.summary)}</p>
        </li>
      ))}
    </ul>
  );
}
