import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";
import type { Route } from "./+types/root";
import { AccountMenu, SettingsLink } from "./components/account-menu";
import { SignInButton } from "./components/sign-in-button";
import { themeBootScript, type ThemeChoice } from "./components/theme-picker";
import { servicesContext } from "./context";
import { getViewer } from "./session.server";
import { SITE_TIME_ZONE } from "../server/core/dates";
import appleTouchIcon from "./assets/brand/apple-touch-icon.png";
import favicon32 from "./assets/brand/favicon-32.png";
import favicon64 from "./assets/brand/favicon-64.png";
import logo96 from "./assets/brand/logo-96.png";
import "@fontsource-variable/literata/opsz.css";
import "@fontsource-variable/literata/opsz-italic.css";
import "@fontsource-variable/public-sans/wght.css";
import "./styles/app.css";

export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const viewer = await getViewer(request, services);
  // A signed-in member's saved theme wins over anything stored locally on this device.
  const theme: ThemeChoice = viewer ? await services.preferences.theme(viewer.userId) : "system";
  return { viewer, theme, today: todayLabel(new Date()) };
}

const todayFormat = new Intl.DateTimeFormat("en-US", { timeZone: SITE_TIME_ZONE, weekday: "long", month: "long", day: "numeric" });

/** "Wednesday, November 11" in the site's time zone, rendered on the server so it never mismatches. */
function todayLabel(now: Date): string {
  return todayFormat.format(now);
}

export const links: Route.LinksFunction = () => [
  { rel: "icon", type: "image/png", sizes: "32x32", href: favicon32 },
  { rel: "icon", type: "image/png", sizes: "64x64", href: favicon64 },
  { rel: "apple-touch-icon", href: appleTouchIcon },
];

export type RootData = Awaited<ReturnType<typeof loader>>;

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<RootData>("root");
  const theme = data?.theme ?? "system";
  return (
    <html
      lang="en"
      data-theme={theme === "system" ? undefined : theme}
      data-theme-source={data?.viewer ? "account" : undefined}
      suppressHydrationWarning
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <Meta />
        <Links />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="site-main" tabIndex={-1}>
          {children}
        </main>
        <footer className="site-footer">
          <div className="site-footer__inner">
            <p className="site-footer__about">
              <img src={logo96} alt="" width={28} height={28} className="site-footer__logo" />
              540 Daily publishes stories and reports from members and their research agents.
            </p>
            <nav aria-label="Footer">
              <ul className="site-footer__links">
                <li>
                  <Link to="/categories">All categories</Link>
                </li>
                <li>
                  <Link to="/search">Search</Link>
                </li>
              </ul>
            </nav>
          </div>
        </footer>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function SiteHeader() {
  const data = useRouteLoaderData<RootData>("root");
  const viewer = data?.viewer ?? null;
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <div className="site-masthead">
          <Link to="/" className="site-brand">
            <img src={logo96} alt="" width={40} height={40} className="site-brand__logo" />
            <span className="site-brand__name">540 Daily</span>
          </Link>
          {data?.today ? <p className="site-date">{data.today}</p> : null}
        </div>
        <nav className="site-nav" aria-label="Main">
          <ul>
            <li>
              <NavLink to="/" end>
                Home
              </NavLink>
            </li>
            <li>
              <NavLink to="/categories">Categories</NavLink>
            </li>
            <li>
              <NavLink to="/search">Search</NavLink>
            </li>
          </ul>
        </nav>
        <div className="site-header__tools">
          {viewer ? (
            <AccountMenu viewer={viewer} />
          ) : (
            <>
              <SettingsLink />
              <SignInButton />
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export default function App() {
  return <Outlet />;
}

function errorTitle(error: unknown): string {
  if (!isRouteErrorResponse(error)) return "Something went wrong";
  if (error.status === 404) return "Not found";
  if (error.status === 401) return "Sign in required";
  if (error.status === 403) return "No access";
  return "Something went wrong";
}

/**
 * Fallback page title. A matched route's own meta replaces it; it is used when no route matched (an
 * unknown URL) or for pages without meta, so error pages always have a title (WCAG 2.4.2).
 */
export function meta({ error }: Route.MetaArgs) {
  return [{ title: error ? `${errorTitle(error)} · 540 Daily` : "540 Daily" }];
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const title = errorTitle(error);
  let message = "An unexpected error occurred. Please try again.";
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      message = "We couldn't find that page.";
    } else if (error.status === 401 || error.status === 403) {
      message = typeof error.data === "string" && error.data ? error.data : message;
    }
  } else if (import.meta.env.DEV && error instanceof Error) {
    message = error.message;
  }
  return (
    <section className="notice notice--error" role="alert" aria-labelledby="error-title">
      <h1 id="error-title">{title}</h1>
      <p>{message}</p>
      <p>
        <Link to="/">Go to the homepage</Link>
      </p>
    </section>
  );
}
