import type { ShouldRevalidateFunctionArgs } from "react-router";
import { useEffect, useRef } from "react";
import { Form, data, useNavigation } from "react-router";
import { moveCategory } from "../../server/core/categories";
import { HTTP_STATUS } from "../../server/core/result";
import { EditorNav, ErrorNotice, editorLinks, NOINDEX_META } from "../components/editor/shared";
import { servicesContext } from "../context";
import type { Route } from "./+types/editor.homepage";
import { requireEditorPage, requireEditorWrite } from "./editor.server";

export const links = editorLinks;

/** Reload after every action, including a refused stale one, so the page shows the latest state. */
export const shouldRevalidate = ({ actionStatus, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) =>
  actionStatus !== undefined ? true : defaultShouldRevalidate;

export function meta(_: Route.MetaArgs) {
  return [{ title: "Homepage layout · Editor · 540 Daily" }, NOINDEX_META];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  await requireEditorPage(request, services);
  const [layout, all] = await Promise.all([services.homepage.layout(), services.categories.listAll()]);
  const shown = new Set(layout.map((c) => c.id));
  return {
    layout: layout.map(({ id, name }) => ({ id, name })),
    available: all.filter((c) => !shown.has(c.id)).map(({ id, name }) => ({ id, name })),
  };
}

const INTENTS = ["up", "down", "remove", "add"] as const;
type Intent = (typeof INTENTS)[number];

export async function action({ request, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  const actor = await requireEditorWrite(request, services);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "") as Intent;
  const categoryId = String(form.get("categoryId") ?? "");
  const seen = String(form.get("order") ?? "");
  if (!INTENTS.includes(intent) || !categoryId) return data({ ok: false as const, message: "Unknown change.", focus: null }, { status: 400 });

  const currentLayout = await services.homepage.layout();
  const current = currentLayout.map((c) => c.id);
  // Changes apply to the layout the editor saw. If another editor changed it meanwhile, show the new one.
  if (current.join(",") !== seen) {
    return data({ ok: false as const, message: "The homepage layout changed since this page loaded. The latest layout is shown; try again.", focus: null }, { status: 409 });
  }
  let next: string[];
  if (intent === "up" || intent === "down") next = moveCategory(current, categoryId, intent);
  else if (intent === "remove") next = current.filter((id) => id !== categoryId);
  else next = current.includes(categoryId) ? current : [...current, categoryId];

  const result = await services.homepage.setLayout(actor, next);
  if (!result.ok) return data({ ok: false as const, message: result.message, focus: null }, { status: HTTP_STATUS[result.status] });
  const name = [...result.value, ...currentLayout].find((c) => c.id === categoryId)?.name ?? "Category";
  const position = next.indexOf(categoryId) + 1;
  const message =
    intent === "remove"
      ? `${name} removed from the homepage.`
      : intent === "add"
        ? `${name} added to the homepage at position ${position}.`
        : `${name} moved ${intent} to position ${position} of ${next.length}.`;
  return { ok: true as const, message, focus: { categoryId, intent } };
}

export default function HomepageLayout({ loaderData, actionData }: Route.ComponentProps) {
  const { layout, available } = loaderData;
  const busy = useNavigation().state !== "idle";
  const order = layout.map((c) => c.id).join(",");
  const listRef = useRef<HTMLElement>(null);

  // Keep keyboard focus on the item that moved, so repeated presses keep moving it.
  useEffect(() => {
    const focus = actionData?.focus;
    if (!focus || busy) return;
    const root = listRef.current;
    const pick = (selector: string) => root?.querySelector<HTMLButtonElement>(selector);
    const id = CSS.escape(focus.categoryId);
    const target =
      focus.intent === "up" || focus.intent === "down"
        ? (pick(`[data-category="${id}"][data-intent="${focus.intent}"]:not([disabled])`) ??
          pick(`[data-category="${id}"][data-intent="${focus.intent === "up" ? "down" : "up"}"]:not([disabled])`) ??
          pick(`[data-category="${id}"][data-intent="remove"]`))
        : focus.intent === "add"
          ? pick(`[data-category="${id}"][data-intent="remove"]`)
          : null;
    (target ?? root?.querySelector<HTMLElement>("h2"))?.focus();
  }, [actionData, busy]);

  return (
    <section aria-labelledby="page-title" className="editor" ref={listRef}>
      <EditorNav />
      <h1 id="page-title">Homepage layout</h1>
      <p className="muted">Choose which categories appear as panels on the public homepage, and in what order. New categories are never added automatically.</p>
      <p className="visually-hidden" role="status">
        {actionData?.ok ? actionData.message : ""}
      </p>
      {actionData?.ok ? (
        <p className="notice notice--success" aria-hidden="true">
          {actionData.message}
        </p>
      ) : null}
      <ErrorNotice message={actionData && !actionData.ok ? actionData.message : null} />

      <h2 id="shown-title" tabIndex={-1}>
        On the homepage
      </h2>
      {layout.length === 0 ? <p className="notice">No categories are on the homepage. Visitors see an empty state until you add one.</p> : null}
      <ol className="layout-list" aria-labelledby="shown-title">
        {layout.map((c, i) => (
          <li key={c.id} className="layout-item">
            <span className="layout-item__name">
              <span className="layout-item__position" aria-hidden="true">
                {i + 1}.
              </span>{" "}
              {c.name}
            </span>
            <Form method="post" className="layout-item__actions">
              <input type="hidden" name="order" value={order} />
              <input type="hidden" name="categoryId" value={c.id} />
              <button type="submit" className="button" name="intent" value="up" data-category={c.id} data-intent="up" disabled={busy || i === 0} >
                Move up<span className="visually-hidden"> {c.name}</span>
              </button>
              <button
                type="submit"
                className="button"
                name="intent"
                value="down"
                data-category={c.id}
                data-intent="down"
                disabled={busy || i === layout.length - 1}
              >
                Move down<span className="visually-hidden"> {c.name}</span>
              </button>
              <button type="submit" className="button" name="intent" value="remove" data-category={c.id} data-intent="remove" disabled={busy}>
                Remove<span className="visually-hidden"> {c.name} from the homepage</span>
              </button>
            </Form>
          </li>
        ))}
      </ol>

      <h2 id="available-title" tabIndex={-1}>
        Other categories
      </h2>
      {available.length === 0 ? <p className="muted">Every category is on the homepage.</p> : null}
      <ul className="layout-list" aria-labelledby="available-title">
        {available.map((c) => (
          <li key={c.id} className="layout-item">
            <span className="layout-item__name">{c.name}</span>
            <Form method="post" className="layout-item__actions">
              <input type="hidden" name="order" value={order} />
              <input type="hidden" name="categoryId" value={c.id} />
              <button type="submit" className="button" name="intent" value="add" data-category={c.id} data-intent="add" disabled={busy}>
                Add<span className="visually-hidden"> {c.name} to the homepage</span>
              </button>
            </Form>
          </li>
        ))}
      </ul>
    </section>
  );
}
