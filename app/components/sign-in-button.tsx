import { useState } from "react";
import { Link, useLocation } from "react-router";
import { authClient } from "../auth-client";

/**
 * Header sign-in: goes straight to Google and returns to the current page.
 * It is a link to /sign-in, so it still works before JavaScript loads; that page also shows sign-in errors.
 */
export function SignInButton() {
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const next = location.pathname.startsWith("/sign-in") ? "/" : `${location.pathname}${location.search}`;
  const fallback = `/sign-in?next=${encodeURIComponent(next)}`;

  return (
    <Link
      to={fallback}
      className="button"
      aria-disabled={busy || undefined}
      onClick={async (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        const result = await authClient.signIn.social({ provider: "google", callbackURL: next, errorCallbackURL: fallback });
        // On success the browser is already leaving for Google. On failure, show the sign-in page with its message.
        if (result.error) window.location.assign(fallback);
      }}
    >
      {busy ? "Opening Google…" : "Sign in"}
    </Link>
  );
}
