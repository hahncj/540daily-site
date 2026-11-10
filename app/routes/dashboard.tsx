import type { ShouldRevalidateFunctionArgs } from "react-router";
import { useEffect, useRef } from "react";
import { data, Form, Link, useNavigation } from "react-router";
import { moveCategory, type Category } from "../../server/core/categories";
import { PANEL_SIZE } from "../../server/core/publications";
import { HTTP_STATUS } from "../../server/core/result";
import { requireRolePage } from "../access.server";
import { PublicationList } from "../components/publication-list";
import { servicesContext } from "../context";
import { readerWrite } from "../reader.server";
import "../styles/reader.css";
import type { Services } from "../../server/app";
import type { Route } from "./+types/dashboard";

/** Reload after every action, including a refused stale one, so the page shows the latest saved state. */
export const shouldRevalidate = ({ actionStatus, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) =>
  actionStatus !== undefined ? true : defaultShouldRevalidate;

export function meta(_: Route.MetaArgs) {
  return [{ title: "My dashboard · 540 Daily" }, { name: "robots", content: "noindex, nofollow" }];
}

/** Categories a reader may add: those with published content, plus those on the public homepage. */
async function publicCategories(services: Services): Promise<Category[]> {
  const [withPublished, layout] = await Promise.all([services.categories.listWithPublished(), services.homepage.layout()]);
  const out = new Map<string, Category>();
  for (const c of [...withPublished, ...layout]) out.set(c.id, { id: c.id, name: c.name, slug: c.slug });
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The signed-in member's own dashboard. On first visit it copies the public homepage layout;
 * after that, public layout changes never overwrite it. Interest tags filter every panel.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const viewer = await requireRolePage(request, services, "reader");
  const { panels, interestTags } = await services.preferences.dashboard(viewer.userId);
  const tagIds = interestTags.map((t) => t.id);
  const [latest, categories, knownTags] = await Promise.all([
    services.publications.latestPerCategory(
      panels.map((c) => c.id),
      PANEL_SIZE,
      tagIds,
    ),
    publicCategories(services),
    services.tags.listWithPublished(),
  ]);
  const shown = new Set(panels.map((c) => c.id));
  const items = [...latest.values()].flat();
  const savedIds = [...(await services.bookmarks.savedAmong(viewer.userId, items.map((i) => i.id)))];
  // Selected tags stay listed even if nothing published uses them right now, so they can be cleared.
  const tagChoices = new Map(knownTags.map((t) => [t.id, { id: t.id, name: t.name }]));
  for (const t of interestTags) if (!tagChoices.has(t.id)) tagChoices.set(t.id, { id: t.id, name: t.name });
  return {
    panels: panels.map((category) => ({ category, items: latest.get(category.id) ?? [] })),
    available: categories.filter((c) => !shown.has(c.id)).map(({ id, name }) => ({ id, name })),
    interestTags: interestTags.map(({ id, name }) => ({ id, name })),
    tagChoices: [...tagChoices.values()].sort((a, b) => a.name.localeCompare(b.name)),
    savedIds,
  };
}

const PANEL_INTENTS = ["up", "down", "remove", "add", "reset"] as const;
type PanelIntent = (typeof PANEL_INTENTS)[number];
type Focus = { categoryId: string; intent: PanelIntent } | { target: "interests" } | null;

function failure(message: string, status: number) {
  return data({ ok: false as const, message, focus: null as Focus }, { status });
}

/** Every change applies to the signed-in member's own preferences only. */
export async function action({ request, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  const auth = await readerWrite(request, services);
  if ("refused" in auth) return auth.refused;
  const { viewer } = auth;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "theme") {
    const result = await services.preferences.setTheme(viewer.userId, form.get("theme"));
    if (!result.ok) return failure(result.message, HTTP_STATUS[result.status]);
    return { ok: true as const, message: "Theme saved.", focus: null as Focus };
  }

  if (intent === "tags") {
    const chosen = form.getAll("tag").map(String);
    const [known, current] = await Promise.all([services.tags.listWithPublished(), services.preferences.interestTags(viewer.userId)]);
    const allowed = new Set([...known, ...current].map((t) => t.id));
    if (chosen.some((id) => !allowed.has(id))) return failure("Unknown interest tag. Reload the page and try again.", 422);
    const result = await services.preferences.setInterestTags(viewer.userId, chosen);
    if (!result.ok) return failure(result.message, HTTP_STATUS[result.status]);
    const message = result.value.length === 0 ? "Interest filter cleared. Panels show everything." : `Interests saved: ${result.value.map((t) => t.name).join(", ")}.`;
    return { ok: true as const, message, focus: { target: "interests" } as Focus };
  }

  if (!PANEL_INTENTS.includes(intent as PanelIntent)) return failure("Unknown change.", 400);
  const panelIntent = intent as PanelIntent;
  const categoryId = String(form.get("categoryId") ?? "");
  const seen = String(form.get("order") ?? "");
  const { panels } = await services.preferences.dashboard(viewer.userId);
  const current = panels.map((c) => c.id);
  // Changes apply to the order the member saw. If another device changed it meanwhile, show the new one.
  if (current.join(",") !== seen) {
    return failure("Your dashboard changed on another device or tab. The latest layout is shown; try again.", 409);
  }

  let next: string[];
  let name = panels.find((c) => c.id === categoryId)?.name ?? "";
  if (panelIntent === "reset") {
    next = (await services.homepage.layout()).map((c) => c.id);
  } else if (panelIntent === "add") {
    const category = (await publicCategories(services)).find((c) => c.id === categoryId);
    if (!category) return failure("That category isn't available.", 422);
    name = category.name;
    next = current.includes(categoryId) ? current : [...current, categoryId];
  } else {
    if (!current.includes(categoryId)) return failure("That panel isn't on your dashboard.", 422);
    next = panelIntent === "remove" ? current.filter((id) => id !== categoryId) : moveCategory(current, categoryId, panelIntent);
  }

  const result = await services.preferences.setPanels(viewer.userId, next);
  if (!result.ok) return failure(result.message, HTTP_STATUS[result.status]);
  const position = next.indexOf(categoryId) + 1;
  const message =
    panelIntent === "reset"
      ? "Your panels now match the public homepage."
      : panelIntent === "remove"
        ? `${name} removed from your dashboard.`
        : panelIntent === "add"
          ? `${name} added to your dashboard at position ${position}.`
          : `${name} moved ${panelIntent} to position ${position} of ${next.length}.`;
  return { ok: true as const, message, focus: { categoryId, intent: panelIntent } as Focus };
}

export default function Dashboard({ loaderData, actionData }: Route.ComponentProps) {
  const { panels, available, interestTags, tagChoices, savedIds } = loaderData;
  const busy = useNavigation().state !== "idle";
  const order = panels.map((p) => p.category.id).join(",");
  const settingsRef = useRef<HTMLElement>(null);
  const selected = new Set(interestTags.map((t) => t.id));
  const filtered = interestTags.length > 0;

  // Keep keyboard focus on the control that was used, so repeated presses keep moving the same panel.
  useEffect(() => {
    const focus = actionData?.focus;
    if (!focus || busy) return;
    const root = settingsRef.current;
    if ("target" in focus) {
      root?.querySelector<HTMLElement>("#interests-title")?.focus();
      return;
    }
    const pick = (selector: string) => root?.querySelector<HTMLElement>(selector);
    const id = CSS.escape(focus.categoryId);
    const target =
      focus.intent === "up" || focus.intent === "down"
        ? (pick(`[data-category="${id}"][data-intent="${focus.intent}"]:not([disabled])`) ??
          pick(`[data-category="${id}"][data-intent="${focus.intent === "up" ? "down" : "up"}"]:not([disabled])`) ??
          pick(`[data-category="${id}"][data-intent="remove"]`))
        : focus.intent === "add"
          ? pick(`[data-category="${id}"][data-intent="remove"]`)
          : null;
    (target ?? pick("#panels-title"))?.focus();
  }, [actionData, busy]);

  return (
    <section aria-labelledby="page-title" className="dashboard">
      <h1 id="page-title">My dashboard</h1>
      <p className="muted">
        Your own panels and interests, saved to your account. They don't change the public homepage.{" "}
        <a href="#customize">Customize</a>
      </p>
      {filtered ? (
        <p className="notice">
          Showing only items tagged {interestTags.map((t) => t.name).join(", ")}. <a href="#interests-title">Change interests</a>
        </p>
      ) : null}

      {panels.length === 0 ? (
        <p className="notice muted">
          Your dashboard has no panels. <a href="#customize">Add a category</a> to get started.
        </p>
      ) : (
        <div className="panel-grid">
          {panels.map(({ category, items }) => (
            <section key={category.id} className="panel category-panel" aria-labelledby={`panel-${category.id}`}>
              <h2 id={`panel-${category.id}`} className="category-panel__title">
                <Link to={`/categories/${category.slug}`}>{category.name}</Link>
              </h2>
              {items.length === 0 ? (
                <p className="muted">{filtered ? `Nothing in ${category.name} matches your interests yet.` : `Nothing published in ${category.name} yet.`}</p>
              ) : (
                <>
                  <PublicationList items={items} savedIds={savedIds} />
                  <p className="category-panel__more">
                    <Link to={`/categories/${category.slug}`}>
                      More in {category.name}
                      <span aria-hidden="true"> →</span>
                    </Link>
                  </p>
                </>
              )}
            </section>
          ))}
        </div>
      )}

      <section id="customize" aria-labelledby="customize-title" className="dashboard-settings" ref={settingsRef}>
        <h2 id="customize-title">Customize</h2>
        <p className="visually-hidden" role="status">
          {actionData?.ok ? actionData.message : ""}
        </p>
        {actionData?.ok ? (
          <p className="notice notice--success" aria-hidden="true">
            {actionData.message}
          </p>
        ) : null}
        {actionData && !actionData.ok ? (
          <p className="notice notice--error" role="alert">
            {actionData.message}
          </p>
        ) : null}

        <h3 id="panels-title" tabIndex={-1}>
          Your panels
        </h3>
        {panels.length === 0 ? <p className="muted">No panels yet.</p> : null}
        <ol className="layout-list" aria-labelledby="panels-title">
          {panels.map(({ category: c }, i) => (
            <li key={c.id} className="layout-item">
              <span className="layout-item__name">
                <span aria-hidden="true">{i + 1}.</span> {c.name}
              </span>
              <Form method="post" className="layout-item__actions" preventScrollReset>
                <input type="hidden" name="order" value={order} />
                <input type="hidden" name="categoryId" value={c.id} />
                <button type="submit" className="button" name="intent" value="up" data-category={c.id} data-intent="up" disabled={busy || i === 0}>
                  Move up<span className="visually-hidden"> {c.name}</span>
                </button>
                <button
                  type="submit"
                  className="button"
                  name="intent"
                  value="down"
                  data-category={c.id}
                  data-intent="down"
                  disabled={busy || i === panels.length - 1}
                >
                  Move down<span className="visually-hidden"> {c.name}</span>
                </button>
                <button type="submit" className="button" name="intent" value="remove" data-category={c.id} data-intent="remove" disabled={busy}>
                  Remove<span className="visually-hidden"> {c.name} from my dashboard</span>
                </button>
              </Form>
            </li>
          ))}
        </ol>

        <h3 id="available-title">Add a category</h3>
        {available.length === 0 ? <p className="muted">Every category is on your dashboard.</p> : null}
        <ul className="layout-list" aria-labelledby="available-title">
          {available.map((c) => (
            <li key={c.id} className="layout-item">
              <span className="layout-item__name">{c.name}</span>
              <Form method="post" className="layout-item__actions" preventScrollReset>
                <input type="hidden" name="order" value={order} />
                <input type="hidden" name="categoryId" value={c.id} />
                <button type="submit" className="button" name="intent" value="add" data-category={c.id} data-intent="add" disabled={busy}>
                  Add<span className="visually-hidden"> {c.name} to my dashboard</span>
                </button>
              </Form>
            </li>
          ))}
        </ul>
        <Form method="post" className="dashboard-settings__reset" preventScrollReset>
          <input type="hidden" name="order" value={order} />
          <button type="submit" className="button" name="intent" value="reset" disabled={busy}>
            Reset panels to the public homepage
          </button>
        </Form>

        <h3 id="interests-title" tabIndex={-1}>
          Interests
        </h3>
        {tagChoices.length === 0 ? (
          <p className="muted">No interest tags are in use yet.</p>
        ) : (
          <Form method="post" className="interest-form" preventScrollReset>
            <fieldset>
              <legend>Show only items with any of these tags. Leave all unchecked to see everything.</legend>
              <ul className="interest-list">
                {tagChoices.map((t) => (
                  <li key={t.id}>
                    <label>
                      <input type="checkbox" name="tag" value={t.id} defaultChecked={selected.has(t.id)} /> {t.name}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
            <button type="submit" className="button button--primary" name="intent" value="tags" disabled={busy}>
              Save interests
            </button>
          </Form>
        )}
      </section>
    </section>
  );
}
