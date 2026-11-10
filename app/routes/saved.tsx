import { useEffect, useRef, useState } from "react";
import { data, Form, redirect, useLocation } from "react-router";
import { HTTP_STATUS } from "../../server/core/result";
import { requireRolePage, safeNextPath } from "../access.server";
import { formatDate, isoString, pageParam } from "../components/format";
import { Pagination } from "../components/pagination";
import { PublicationListEntry } from "../components/publication-list";
import { servicesContext } from "../context";
import { readerWrite } from "../reader.server";
import type { Route } from "./+types/saved";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Saved · 540 Daily" }, { name: "robots", content: "noindex, nofollow" }];
}

/** The member's own bookmarks, newest first, each resolved to the current published version. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const viewer = await requireRolePage(request, services, "reader");
  const page = pageParam(new URL(request.url).searchParams.get("page"));
  return { saved: await services.bookmarks.list(viewer.userId, page) };
}

/**
 * Save or remove a bookmark for the signed-in member. Bookmark buttons on every page post here.
 * With JavaScript (`js=1`) the result returns in place; without it, the browser goes back to `next`.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  const auth = await readerWrite(request, services);
  if ("refused" in auth) return auth.refused;
  const { viewer } = auth;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const publicationId = String(form.get("publicationId") ?? "");
  const result =
    intent === "save"
      ? await services.bookmarks.save(viewer.userId, publicationId)
      : intent === "remove"
        ? await services.bookmarks.remove(viewer.userId, publicationId)
        : null;
  if (!result) return data({ ok: false as const, message: "Unknown change." }, { status: 400 });
  if (!result.ok) return data({ ok: false as const, message: result.message }, { status: HTTP_STATUS[result.status] });
  if (form.get("js") !== "1") throw redirect(safeNextPath(String(form.get("next") ?? ""), "/saved"));
  return { ok: true as const, saved: result.value.saved };
}

export default function Saved({ loaderData, actionData }: Route.ComponentProps) {
  const { saved } = loaderData;
  const location = useLocation();
  const beyondLastPage = saved.items.length === 0 && saved.total > 0;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousTotal = useRef(saved.total);
  const [status, setStatus] = useState("");

  // A removed item takes its focused button with it: move focus to the heading and announce the change.
  useEffect(() => {
    if (saved.total < previousTotal.current) {
      headingRef.current?.focus();
      setStatus(`Removed from saved. ${saved.total === 1 ? "1 item" : `${saved.total} items`} left.`);
    }
    previousTotal.current = saved.total;
  }, [saved.total]);

  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" ref={headingRef} tabIndex={-1}>
        Saved
      </h1>
      <p className="visually-hidden" role="status">
        {status}
      </p>
      <p className="muted">Only you can see what you save. Saved items show their latest published version.</p>
      {actionData && !actionData.ok ? (
        <p className="notice notice--error" role="alert">
          {actionData.message}
        </p>
      ) : null}
      {saved.total === 0 ? (
        <p className="notice muted">Nothing saved yet. Use the Save button on any story or report to keep it here.</p>
      ) : beyondLastPage ? (
        <p className="notice muted">There are no saved items on this page.</p>
      ) : (
        <ul className="publication-list saved-list">
          {saved.items.map((entry) =>
            entry.kind === "available" ? (
              <li key={entry.publicationId} className="publication-item">
                <PublicationListEntry item={entry.item} headingLevel={2} showCategory saved />
              </li>
            ) : (
              <li key={entry.publicationId} className="publication-item saved-list__unavailable">
                <h2 className="publication-item__title">Unavailable item</h2>
                <p className="publication-item__meta">
                  Saved <time dateTime={isoString(entry.savedAt)}>{formatDate(entry.savedAt)}</time>
                </p>
                <p className="publication-item__summary">This item is no longer available.</p>
                <Form method="post" className="bookmark" preventScrollReset>
                  <input type="hidden" name="intent" value="remove" />
                  <input type="hidden" name="publicationId" value={entry.publicationId} />
                  <input type="hidden" name="next" value={location.pathname + location.search} />
                  <button type="submit" className="button">
                    Remove<span className="visually-hidden"> unavailable item saved {formatDate(entry.savedAt)}</span>
                  </button>
                </Form>
              </li>
            ),
          )}
        </ul>
      )}
      <Pagination page={saved.page} pageSize={saved.pageSize} total={saved.total} basePath="/saved" label="Saved pages" />
    </section>
  );
}
