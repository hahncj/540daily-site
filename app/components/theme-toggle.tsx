import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import "../styles/reader.css";
import type { ThemeChoice } from "../../server/core/preferences";

export type { ThemeChoice };
export const THEME_STORAGE_KEY = "540daily.theme";

function readStoredTheme(): ThemeChoice | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" || value === "system" ? value : null;
  } catch {
    return null;
  }
}

function applyTheme(theme: ThemeChoice) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

/**
 * Theme switcher. Anonymous visitors keep their choice in localStorage on this device. A signed-in
 * member's choice is saved to their account (through the dashboard action), so it follows them across
 * devices. Switching the theme is never a content-edit permission.
 */
export function ThemeToggle({ initial, signedIn }: { initial: ThemeChoice; signedIn: boolean }) {
  const [theme, setTheme] = useState<ThemeChoice>(initial);
  const fetcher = useFetcher<{ ok: boolean; message?: string }>();

  useEffect(() => {
    if (signedIn) setTheme(initial);
    else setTheme(readStoredTheme() ?? "system");
  }, [initial, signedIn]);

  function choose(next: ThemeChoice) {
    setTheme(next);
    applyTheme(next);
    if (signedIn) {
      fetcher.submit({ intent: "theme", theme: next }, { method: "post", action: "/dashboard" });
      return;
    }
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage may be unavailable (private mode); the choice still applies for this page view.
    }
  }

  const failed = signedIn && fetcher.state === "idle" && fetcher.data && !fetcher.data.ok;

  return (
    <span className="theme-toggle">
      <label>
        <span className="visually-hidden">Color theme</span>
        <select className="button" value={theme} onChange={(e) => choose(e.currentTarget.value as ThemeChoice)}>
          <option value="system">Theme: device</option>
          <option value="light">Theme: light</option>
          <option value="dark">Theme: dark</option>
        </select>
      </label>
      {failed ? (
        <span className="theme-toggle__error" role="alert">
          Theme not saved.{" "}
          <button type="button" className="link-button" onClick={() => choose(theme)}>
            Retry
          </button>
        </span>
      ) : null}
    </span>
  );
}

/**
 * Inline script that applies a stored anonymous theme before first paint, to avoid a flash.
 * Skipped when the server rendered a signed-in member's saved theme (`data-theme-source="account"`).
 */
export const themeBootScript = `try{var d=document.documentElement;if(d.getAttribute("data-theme-source")!=="account"){var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark"){d.setAttribute("data-theme",t)}else if(t==="system"){d.removeAttribute("data-theme")}}}catch(e){}`;
