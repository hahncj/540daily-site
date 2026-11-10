import { Link, redirect } from "react-router";
import { attribution, publicationPath } from "../../server/core/publications";
import { formatDate, formatDateTime, isoString, TYPE_LABEL } from "../components/format";
import { PublicationList } from "../components/publication-list";
import { servicesContext } from "../context";
import type { Route } from "./+types/publication";

/** Edits within a minute of publishing are not worth a separate "Updated" line. */
const UPDATED_THRESHOLD_MS = 60_000;

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not found · 540 Daily" }];
  const { publication, canonicalUrl } = loaderData;
  return [
    { title: `${publication.title} · 540 Daily` },
    { name: "description", content: publication.summary },
    { tagName: "link", rel: "canonical", href: canonicalUrl },
    { property: "og:title", content: publication.title },
    { property: "og:description", content: publication.summary },
    { property: "og:type", content: "article" },
    { property: "og:url", content: canonicalUrl },
  ];
}

/**
 * Published detail only. Drafts, unpublished items, and unknown IDs all return the same 404,
 * so nothing reveals that a private item exists. A wrong or missing slug redirects to the canonical path.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const publication = await services.publications.getPublic(params.id);
  if (!publication) throw new Response("Not found", { status: 404 });

  // Compare the slug param, not the URL path: client navigations fetch `<path>.data`.
  const canonicalPath = publicationPath(publication);
  if (params.slug !== canonicalPath.slice(canonicalPath.lastIndexOf("/") + 1)) throw redirect(canonicalPath, 301);

  const [bodyHtml, related] = await Promise.all([
    services.publications.renderBody(publication),
    services.publications.related(publication),
  ]);
  const { bodyMarkdown: _body, attachmentIds: _attachments, ...shown } = publication;
  return {
    publication: {
      ...shown,
      // Core validates source protocols; keep only http(s) here too, as defense in depth.
      sources: shown.sources.filter((s) => /^https?:\/\//i.test(s.url)),
      byline: attribution(publication.createdBy),
    },
    bodyHtml,
    related,
    canonicalUrl: `${services.config.baseUrl}${canonicalPath}`,
  };
}

export default function Publication({ loaderData }: Route.ComponentProps) {
  const { publication: p, bodyHtml, related } = loaderData;
  const showUpdated = p.publishedAt && new Date(p.updatedAt).getTime() - new Date(p.publishedAt).getTime() > UPDATED_THRESHOLD_MS;

  return (
    <article className="publication" aria-labelledby="page-title">
      <header className="publication__header">
        <p className="publication__kicker">
          <span className={`type-label type-label--${p.type}`}>{TYPE_LABEL[p.type]}</span>
          {" · "}
          <Link to={`/categories/${p.category.slug}`}>{p.category.name}</Link>
        </p>
        <h1 id="page-title">{p.title}</h1>
        <p className="publication__summary">{p.summary}</p>
        <dl className="publication__meta">
          <div>
            <dt>By</dt>
            <dd>{p.byline}</dd>
          </div>
          {p.publishedAt ? (
            <div>
              <dt>Published</dt>
              <dd>
                <time dateTime={isoString(p.publishedAt)}>{formatDateTime(p.publishedAt)}</time>
              </dd>
            </div>
          ) : null}
          {showUpdated ? (
            <div>
              <dt>Updated</dt>
              <dd>
                <time dateTime={isoString(p.updatedAt)}>{formatDateTime(p.updatedAt)}</time>
              </dd>
            </div>
          ) : null}
          {p.sourcePublishedAt ? (
            <div>
              <dt>Source date</dt>
              <dd>
                <time dateTime={isoString(p.sourcePublishedAt)}>{formatDate(p.sourcePublishedAt)}</time>
              </dd>
            </div>
          ) : null}
        </dl>
      </header>

      {/* Safe HTML from publications.renderBody: raw HTML is disabled and the output is allowlist-sanitized. */}
      {bodyHtml ? <div className="prose" dangerouslySetInnerHTML={{ __html: bodyHtml }} /> : null}

      {p.tags.length > 0 ? (
        <section aria-labelledby="tags-title" className="publication__section">
          <h2 id="tags-title">Tags</h2>
          <ul className="tag-list">
            {p.tags.map((t) => (
              <li key={t.id} className="tag">
                {t.name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {p.sources.length > 0 ? (
        <section aria-labelledby="sources-title" className="publication__section">
          <h2 id="sources-title">Sources</h2>
          <p className="muted small">Links supplied by the author. 540 Daily does not fetch or verify them.</p>
          <ul className="source-list">
            {p.sources.map((s, i) => (
              <li key={`${i}-${s.url}`}>
                <a href={s.url} rel="nofollow noopener noreferrer ugc">
                  {s.label || s.url}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="related-title" className="publication__section">
        <h2 id="related-title">More in {p.category.name}</h2>
        {related.length === 0 ? (
          <p className="muted">No other publications in {p.category.name} yet.</p>
        ) : (
          <PublicationList items={related} />
        )}
      </section>
    </article>
  );
}
