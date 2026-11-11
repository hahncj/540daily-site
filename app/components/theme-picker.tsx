import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { ThemeChoice } from "../../server/core/preferences";

export type { ThemeChoice };
export const THEME_STORAGE_KEY = "540daily.theme";

const OPTIONS: ReadonlyArray<{ value: ThemeChoice; label: string; hint: string }> = [
  { value: "system", label: "Auto", hint: "Match this device" },
  { value: "light", label: "Light", hint: "Always light" },
  { value: "dark", label: "Dark", hint: "Always dark" },
];

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
 * Appearance choice on the Settings page. Visitors keep their choice in localStorage on this device.
 * A signed-in member's choice is saved to their account (through the settings action), so it follows
 * them across devices. Switching the theme is never a content-edit permission.
 */
export function ThemePicker({ initial, signedIn }: { initial: ThemeChoice; signedIn: boolean }) {
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
      fetcher.submit({ intent: "theme", theme: next }, { method: "post", action: "/settings" });
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
    <fieldset className="theme-picker">
      <legend>Color theme</legend>
      <div className="theme-picker__options">
        {OPTIONS.map((o) => (
          <label key={o.value} className="theme-picker__option" data-choice={o.value}>
            <input type="radio" name="theme" value={o.value} checked={theme === o.value} onChange={() => choose(o.value)} />
            <span className="theme-picker__swatch" aria-hidden="true" />
            <span className="theme-picker__text">
              <span className="theme-picker__label">{o.label}</span>
              <span className="theme-picker__hint">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="theme-picker__note muted">{signedIn ? "Saved to your account, so it follows you to other devices." : "Saved on this device."}</p>
      {failed ? (
        <p className="theme-picker__error" role="alert">
          Theme not saved.{" "}
          <button type="button" className="link-button" onClick={() => choose(theme)}>
            Retry
          </button>
        </p>
      ) : null}
    </fieldset>
  );
}

/**
 * Inline script that applies a stored anonymous theme before first paint, to avoid a flash.
 * Skipped when the server rendered a signed-in member's saved theme (`data-theme-source="account"`).
 */
export const themeBootScript = `try{var d=document.documentElement;if(d.getAttribute("data-theme-source")!=="account"){var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark"){d.setAttribute("data-theme",t)}else if(t==="system"){d.removeAttribute("data-theme")}}}catch(e){}`;
