import { useState } from "react";
import { redirect } from "react-router";
import { SIGN_IN_REFUSAL_MESSAGES } from "../../server/core/access";
import { safeNextPath } from "../access.server";
import { authClient } from "../auth-client";
import { servicesContext } from "../context";
import { getViewer } from "../session.server";
import type { Route } from "./+types/sign-in";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Sign in · 540 News" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"));
  const viewer = await getViewer(request, context.get(servicesContext));
  if (viewer) throw redirect(next);
  const code = url.searchParams.get("error");
  const error = code
    ? (SIGN_IN_REFUSAL_MESSAGES[code as keyof typeof SIGN_IN_REFUSAL_MESSAGES] ?? "Sign-in did not complete. Please try again.")
    : null;
  return { next, error };
}

export default function SignIn({ loaderData }: Route.ComponentProps) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setFailure(null);
    const result = await authClient.signIn.social({
      provider: "google",
      callbackURL: loaderData.next,
      errorCallbackURL: `/sign-in?next=${encodeURIComponent(loaderData.next)}`,
    });
    if (result.error) {
      setFailure("Could not start Google sign-in. Please try again.");
      setBusy(false);
    }
  }

  const message = failure ?? loaderData.error;
  return (
    <section aria-labelledby="page-title" className="panel">
      <h1 id="page-title">Sign in</h1>
      <p>540 News accounts are invitation-only. Sign in with the Google account your invitation was sent to.</p>
      {message ? (
        <p className="notice notice--error" role="alert">
          {message}
        </p>
      ) : null}
      <button type="button" className="button button--primary" onClick={signIn} disabled={busy}>
        {busy ? "Opening Google…" : "Sign in with Google"}
      </button>
      <p className="muted">Reading the news does not require an account.</p>
    </section>
  );
}
