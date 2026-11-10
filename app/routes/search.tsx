import { useEffect, useRef } from "react";
import { data, Form, Link, useNavigation } from "react-router";
import { DATE_BASIS_NOTE } from "../../server/core/dates";
import { PUBLICATION_TYPES } from "../../server/core/publications";
import { MAX_QUERY_LENGTH, toMatchExpression } from "../../server/core/search";
import { pageParam, TYPE_PLURAL } from "../components/format";
import { Pagination } from "../components/pagination";
import { PublicationList } from "../components/publication-list";
import { servicesContext } from "../context";
import { savedIdsFor } from "../reader.server";
import type { Route } from "./+types/search";

const FIELDS = ["q", "category", "type", "from", "to"] as const;
type Field = (typeof FIELDS)[number];

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Search · 540 Daily" },
    { name: "description", content: "Search 540 Daily stories and reports by keyword, category, type, and date." },
  ];
}

/**
 * Keyword search over published items (title, summary, body), with category, type, and inclusive
 * Central Time date filters. Without keywords it lists the newest published items that match the filters.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const url = new URL(request.url);
  const values = Object.fromEntries(FIELDS.map((f) => [f, (url.searchParams.get(f) ?? "").trim()])) as Record<Field, string>;
  const page = pageParam(url.searchParams.get("page"));

  const input: Record<string, unknown> = { page };
  for (const f of FIELDS) if (values[f]) input[f] = values[f];

  const [result, categories] = await Promise.all([services.search.publicSearch(input), services.categories.listWithPublished()]);
  const base = { values, categories, noSearchableWords: Boolean(values.q) && toMatchExpression(values.q) === null };
  if (!result.ok) {
    return data({ ...base, results: null, errors: result.errors ?? { _: [result.message] }, savedIds: null }, { status: 400 });
  }
  const savedIds = await savedIdsFor(request, services, result.value.items.map((i) => i.id));
  return { ...base, results: result.value, errors: null, savedIds };
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const { values, categories, results, errors, noSearchableWords, savedIds } = loaderData;
  const navigation = useNavigation();
  const params = new URLSearchParams(FIELDS.flatMap((f) => (values[f] ? [[f, values[f]]] : [])));
  const filtered = FIELDS.some((f) => values[f]);
  const query = params.toString();
  const formRef = useRef<HTMLFormElement>(null);
  // The fields are uncontrolled; after Clear, back, or forward, show the values for the current URL
  // without remounting the form (a remount would drop keyboard focus). Date inputs are not reset from
  // script: WebKit then blocks submission, so their fieldset is remounted instead (keyed below).
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    for (const f of ["q", "category", "type"] as const) {
      const field = form.elements.namedItem(f);
      if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = values[f];
    }
    // Keyed on the query string so a revalidation with the same search never overwrites typing.
  }, [query]);
  const searching = navigation.state === "loading" && navigation.location.pathname === "/search";
  const errorFor = (field: Field) => errors?.[field]?.join(" ");

  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title">Search</h1>
      <Form ref={formRef} method="get" action="/search" className="search-form panel" role="search" aria-label="Publications">
        <div className="field field--wide">
          <label htmlFor="search-q">Keywords</label>
          <input
            id="search-q"
            name="q"
            type="search"
            defaultValue={values.q}
            maxLength={MAX_QUERY_LENGTH}
            aria-invalid={errorFor("q") ? true : undefined}
            aria-describedby={errorFor("q") ? "search-q-error" : undefined}
          />
          {errorFor("q") ? (
            <p id="search-q-error" className="field-error">
              {errorFor("q")}
            </p>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="search-category">Category</label>
          <select id="search-category" name="category" defaultValue={values.category}>
            <option value="">Any category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="search-type">Type</label>
          <select
            id="search-type"
            name="type"
            defaultValue={values.type}
            aria-invalid={errorFor("type") ? true : undefined}
            aria-describedby={errorFor("type") ? "search-type-error" : undefined}
          >
            <option value="">Any type</option>
            {PUBLICATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_PLURAL[t]}
              </option>
            ))}
          </select>
          {errorFor("type") ? (
            <p id="search-type-error" className="field-error">
              {errorFor("type")}
            </p>
          ) : null}
        </div>
        <fieldset key={`${values.from}|${values.to}`} className="field-group" aria-describedby="date-basis">
          <legend>Published between</legend>
          <div className="field">
            <label htmlFor="search-from">From</label>
            <input
              id="search-from"
              name="from"
              type="date"
              defaultValue={values.from}
              aria-invalid={errorFor("from") ? true : undefined}
              aria-describedby={errorFor("from") ? "search-from-error" : undefined}
            />
            {errorFor("from") ? (
              <p id="search-from-error" className="field-error">
                {errorFor("from")}
              </p>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="search-to">To</label>
            <input
              id="search-to"
              name="to"
              type="date"
              defaultValue={values.to}
              aria-invalid={errorFor("to") ? true : undefined}
              aria-describedby={errorFor("to") ? "search-to-error" : undefined}
            />
            {errorFor("to") ? (
              <p id="search-to-error" className="field-error">
                {errorFor("to")}
              </p>
            ) : null}
          </div>
          <p id="date-basis" className="muted small field-group__note">
            {DATE_BASIS_NOTE} Both dates are included.
          </p>
        </fieldset>
        <div className="search-form__actions">
          <button type="submit" className="button button--primary">
            Search
          </button>
          {filtered ? (
            <Link to="/search" className="button">
              Clear
            </Link>
          ) : null}
        </div>
      </Form>

      <div className="search-results" aria-busy={searching || undefined}>
        {errors ? (
          <p className="notice notice--error" role="alert">
            {errors._?.join(" ") || "Please fix the highlighted fields and search again."}
          </p>
        ) : results ? (
          <>
            {noSearchableWords ? (
              <p className="notice muted">Your keywords had no letters or numbers to search for, so these are the newest matches for your filters.</p>
            ) : null}
            <h2 className="visually-hidden">Results</h2>
            <p className="search-results__count" role="status">
              {searching
                ? "Searching…"
                : results.total === 0
                  ? "No results"
                  : `${results.total} ${results.total === 1 ? "result" : "results"}${values.q && !noSearchableWords ? ` for “${values.q}”` : ""}`}
            </p>
            {results.total === 0 ? (
              <p className="muted">
                {filtered ? "Try fewer keywords, another category or type, or a wider date range." : "Nothing has been published yet."}
              </p>
            ) : results.items.length === 0 ? (
              <p className="muted">
                There are no more results. <Link to={params.size ? `/search?${params}` : "/search"}>Go to the first page</Link>.
              </p>
            ) : (
              <PublicationList items={results.items} showCategory savedIds={savedIds} />
            )}
            <Pagination page={results.page} pageSize={results.pageSize} total={results.total} basePath="/search" params={params} label="Search result pages" />
          </>
        ) : null}
      </div>
    </section>
  );
}
