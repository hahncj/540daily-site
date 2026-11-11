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
import { roleAtLeast } from "../server/core/access";
import type { Route } from "./+types/root";
import { AccountAvatar } from "./components/account-avatar";
import { SignInButton } from "./components/sign-in-button";
import { SignOutButton } from "./components/sign-out-button";
import { ThemeToggle, themeBootScript, type ThemeChoice } from "./components/theme-toggle";
import { servicesContext } from "./context";
import { getViewer } from "./session.server";
import "./styles/app.css";

export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  const viewer = await getViewer(request, services);
  // A signed-in member's saved theme wins over anything stored locally on this device.
  const theme: ThemeChoice = viewer ? await services.preferences.theme(viewer.userId) : "system";
  return { viewer, theme };
}

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
            540 Daily publishes stories and reports from members and their research agents.
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
        <Link to="/" className="site-brand">
          540 Daily
        </Link>
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
            {viewer ? (
              <>
                <li>
                  <NavLink to="/dashboard">My dashboard</NavLink>
                </li>
                <li>
                  <NavLink to="/saved">Saved</NavLink>
                </li>
              </>
            ) : null}
            {viewer && roleAtLeast(viewer.role, "editor") ? (
              <li>
                <NavLink to="/editor">Editor</NavLink>
              </li>
            ) : null}
            {viewer && viewer.role === "owner" ? (
              <li>
                <NavLink to="/owner">Owner</NavLink>
              </li>
            ) : null}
          </ul>
        </nav>
        <div className="site-header__tools">
          <ThemeToggle initial={data?.theme ?? "system"} signedIn={!!viewer} />
          {viewer ? (
            <>
              <NavLink to="/account" className="account-link" aria-label="Account" title={viewer.email}>
                <AccountAvatar name={viewer.name} email={viewer.email} image={viewer.image} />
              </NavLink>
              <SignOutButton />
            </>
          ) : (
            <SignInButton />
          )}
        </div>
      </div>
    </header>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred. Please try again.";
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Not found";
      message = "We couldn't find that page.";
    } else if (error.status === 401 || error.status === 403) {
      title = error.status === 401 ? "Sign in required" : "No access";
      message = typeof error.data === "string" && error.data ? error.data : message;
    }
  } else if (import.meta.env.DEV && error instanceof Error) {
    message = error.message;
  }
  return (
    <section className="notice notice--error" role="alert" aria-labelledby="error-title">
      {/* Route meta does not run for errors, so the page title is set here (WCAG 2.4.2). */}
      <title>{`${title} · 540 Daily`}</title>
      <h1 id="error-title">{title}</h1>
      <p>{message}</p>
      <p>
        <Link to="/">Go to the homepage</Link>
      </p>
    </section>
  );
}
