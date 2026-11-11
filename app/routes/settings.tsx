import type { ShouldRevalidateFunctionArgs } from "react-router";
import { useEffect, useRef } from "react";
import { data, Form, Link, useLocation, useNavigation, useRouteLoaderData } from "react-router";
import { moveCategory } from "../../server/core/categories";
import { HTTP_STATUS } from "../../server/core/result";
import { ThemePicker } from "../components/theme-picker";
import { servicesContext } from "../context";
import { addableCategories, homeLayout } from "../home.server";
import { readerWrite } from "../reader.server";
import type { RootData } from "../root";
import { getViewer } from "../session.server";
import "../styles/reader.css";
import type { Route } from "./+types/settings";

/** Reload after every action, including a refused stale one, so the page shows the latest saved state. */
export const shouldRevalidate = ({ actionStatus, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) =>
  actionStatus !== undefined ? true : defaultShouldRevalidate;

export function meta(_: Route.MetaArgs) {
  return [{ title: "Settings · 540 Daily" }, { name: "robots", content: "noindex, nofollow" }];
}

/**
 * Settings for everyone: Appearance (theme) for visitors and members, and for signed-in members
 * their home page panels and interest tags. Panel changes save the member's own layout; until then
 * their home page follows the public layout.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const viewer = await getViewer(request, services);
  if (!viewer) return { home: null };
  const [{ panels, personal, interestTags }, categories, knownTags] = await Promise.all([
    homeLayout(services, viewer),
    addableCategories(services),
    services.tags.listWithPublished(),
  ]);
  const shown = new Set(panels.map((c) => c.id));
  // Selected tags stay listed even if nothing published uses them right now, so they can be cleared.
  const tagChoices = new Map(knownTags.map((t) => [t.id, { id: t.id, name: t.name }]));
  for (const t of interestTags) if (!tagChoices.has(t.id)) tagChoices.set(t.id, { id: t.id, name: t.name });
  return {
    home: {
      personal,
      panels: panels.map(({ id, name }) => ({ id, name })),
      available: categories.filter((c) => !shown.has(c.id)).map(({ id, name }) => ({ id, name })),
      interestTags: interestTags.map(({ id, name }) => ({ id, name })),
      tagChoices: [...tagChoices.values()].sort((a, b) => a.name.localeCompare(b.name)),
    },
  };
}

const PANEL_INTENTS = ["up", "down", "remove", "add", "reset"] as const;
type PanelIntent = (typeof PANEL_INTENTS)[number];
type Focus = { categoryId: string; intent: PanelIntent } | { target: "interests" } | { target: "panels" } | null;

function failure(message: string, status: number) {
  return data({ ok: false as const, message, focus: null as Focus }, { status });
}

/** Every change applies to the signed-in member's own preferences only. Visitors keep their theme on the device. */
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
  const { panels } = await homeLayout(services, viewer);
  const current = panels.map((c) => c.id);
  // Changes apply to the order the member saw. If another device (or an editor, for a member still on
  // the public layout) changed it meanwhile, show the new one.
  if (current.join(",") !== seen) {
    return failure("Your home page layout changed on another device or tab. The latest layout is shown; try again.", 409);
  }

  if (panelIntent === "reset") {
    await services.preferences.resetPanels(viewer.userId);
    return { ok: true as const, message: "Your home page now follows the public layout.", focus: { target: "panels" } as Focus };
  }

  let next: string[];
  let name = panels.find((c) => c.id === categoryId)?.name ?? "";
  if (panelIntent === "add") {
    const category = (await addableCategories(services)).find((c) => c.id === categoryId);
    if (!category) return failure("That category isn't available.", 422);
    name = category.name;
    next = current.includes(categoryId) ? current : [...current, categoryId];
  } else {
    if (!current.includes(categoryId)) return failure("That panel isn't on your home page.", 422);
    next = panelIntent === "remove" ? current.filter((id) => id !== categoryId) : moveCategory(current, categoryId, panelIntent);
  }

  const result = await services.preferences.setPanels(viewer.userId, next);
  if (!result.ok) return failure(result.message, HTTP_STATUS[result.status]);
  const position = next.indexOf(categoryId) + 1;
  const message =
    panelIntent === "remove"
      ? `${name} removed from your home page.`
      : panelIntent === "add"
        ? `${name} added to your home page at position ${position}.`
        : `${name} moved ${panelIntent} to position ${position} of ${next.length}.`;
  return { ok: true as const, message, focus: { categoryId, intent: panelIntent } as Focus };
}

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData<RootData>("root");
  const signedIn = !!root?.viewer;
  const { home } = loaderData;
  const location = useLocation();
  return (
    <section aria-labelledby="page-title" className="settings">
      <h1 id="page-title">Settings</h1>

      <section aria-labelledby="appearance-title" className="settings-section">
        <h2 id="appearance-title">Appearance</h2>
        <ThemePicker initial={root?.theme ?? "system"} signedIn={signedIn} />
      </section>

      <section id="home-page" aria-labelledby="home-page-title" className="settings-section">
        <h2 id="home-page-title">Your home page</h2>
        {home ? (
          <HomePageSettings home={home} actionData={actionData} />
        ) : (
          <p className="muted">
            <Link to={`/sign-in?next=${encodeURIComponent(location.pathname)}`}>Sign in</Link> to choose your own home page panels and
            interests.
          </p>
        )}
      </section>
    </section>
  );
}

type HomeSettings = NonNullable<Route.ComponentProps["loaderData"]["home"]>;

function HomePageSettings({ home, actionData }: { home: HomeSettings; actionData: Route.ComponentProps["actionData"] }) {
  const { personal, panels, available, interestTags, tagChoices } = home;
  const busy = useNavigation().state !== "idle";
  const order = panels.map((p) => p.id).join(",");
  const sectionRef = useRef<HTMLDivElement>(null);
  const selected = new Set(interestTags.map((t) => t.id));

  // Keep keyboard focus on the control that was used, so repeated presses keep moving the same panel.
  useEffect(() => {
    const focus = actionData?.focus;
    if (!focus || busy) return;
    const root = sectionRef.current;
    if ("target" in focus) {
      root?.querySelector<HTMLElement>(focus.target === "interests" ? "#interests-title" : "#panels-title")?.focus();
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
    <div className="home-settings" ref={sectionRef}>
      <p className="muted">
        {personal
          ? "Your home page uses your own panels. Changes to the public layout don't affect it."
          : "Your home page follows the public layout. Changing a panel below saves your own layout."}{" "}
        These settings never change the public homepage.
      </p>
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
        Panels
      </h3>
      {panels.length === 0 ? <p className="muted">No panels yet.</p> : null}
      <ol className="layout-list" aria-labelledby="panels-title">
        {panels.map((c, i) => (
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
                Remove<span className="visually-hidden"> {c.name} from my home page</span>
              </button>
            </Form>
          </li>
        ))}
      </ol>

      <h3 id="available-title">Add a category</h3>
      {available.length === 0 ? <p className="muted">Every category is on your home page.</p> : null}
      <ul className="layout-list" aria-labelledby="available-title">
        {available.map((c) => (
          <li key={c.id} className="layout-item">
            <span className="layout-item__name">{c.name}</span>
            <Form method="post" className="layout-item__actions" preventScrollReset>
              <input type="hidden" name="order" value={order} />
              <input type="hidden" name="categoryId" value={c.id} />
              <button type="submit" className="button" name="intent" value="add" data-category={c.id} data-intent="add" disabled={busy}>
                Add<span className="visually-hidden"> {c.name} to my home page</span>
              </button>
            </Form>
          </li>
        ))}
      </ul>
      {personal ? (
        <Form method="post" className="home-settings__reset" preventScrollReset>
          <input type="hidden" name="order" value={order} />
          <button type="submit" className="button" name="intent" value="reset" disabled={busy}>
            Go back to the public layout
          </button>
        </Form>
      ) : null}

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
    </div>
  );
}
