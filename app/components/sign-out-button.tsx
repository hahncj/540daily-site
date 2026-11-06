import { useState } from "react";
import { authClient } from "../auth-client";

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await authClient.signOut();
        } finally {
          window.location.assign("/");
        }
      }}
    >
      Sign out
    </button>
  );
}
