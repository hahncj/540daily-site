import { useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
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
 * Theme switcher. Anonymous visitors keep their choice in localStorage. Saving the choice to a
 * signed-in member's account arrives with reader preferences (lane 3B).
 */
export function ThemeToggle({ initial }: { initial: ThemeChoice }) {
  const [theme, setTheme] = useState<ThemeChoice>(initial);

  useEffect(() => {
    const stored = readStoredTheme();
    if (stored) setTheme(stored);
  }, []);

  function choose(next: ThemeChoice) {
    setTheme(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage may be unavailable (private mode); the choice still applies for this page view.
    }
  }

  return (
    <label className="theme-toggle">
      <span className="visually-hidden">Color theme</span>
      <select className="button" value={theme} onChange={(e) => choose(e.currentTarget.value as ThemeChoice)}>
        <option value="system">Theme: device</option>
        <option value="light">Theme: light</option>
        <option value="dark">Theme: dark</option>
      </select>
    </label>
  );
}

/** Inline script that applies a stored anonymous theme before first paint, to avoid a flash. */
export const themeBootScript = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}else if(t==="system"){document.documentElement.removeAttribute("data-theme")}}catch(e){}`;
