import { useEffect, useId, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { roleAtLeast } from "../../server/core/access";
import { authClient } from "../auth-client";
import type { SessionViewer as Viewer } from "../session.server";
import { AccountAvatar } from "./account-avatar";

const ROLE_LABEL: Record<Viewer["role"], string> = { reader: "Reader", editor: "Editor", owner: "Owner" };

/** Visitors reach Settings (Appearance) from a gear in the top bar. */
export function SettingsLink() {
  return (
    <NavLink to="/settings" className="icon-button" aria-label="Settings" title="Settings">
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
        <path
          d="M17.15 8.10 L19.07 8.44 L19.07 11.56 L17.15 11.90 L16.40 13.71 L17.51 15.31 L15.31 17.51 L13.71 16.40 L11.90 17.15 L11.56 19.07 L8.44 19.07 L8.10 17.15 L6.29 16.40 L4.69 17.51 L2.49 15.31 L3.60 13.71 L2.85 11.90 L0.93 11.56 L0.93 8.44 L2.85 8.10 L3.60 6.29 L2.49 4.69 L4.69 2.49 L6.29 3.60 L8.10 2.85 L8.44 0.93 L11.56 0.93 L11.90 2.85 L13.71 3.60 L15.31 2.49 L17.51 4.69 L16.40 6.29 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
          transform="translate(1 1) scale(0.9)"
        />
        <circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </NavLink>
  );
}

/**
 * The member's picture (and name on wider screens) opening a small menu. Pages for the member's role
 * (Editor, Homepage layout, Owner console) live here instead of the main nav, with Account, Settings,
 * and Sign out. Closes after navigating, on Escape, and on a tap or click outside.
 */
export function AccountMenu({ viewer }: { viewer: Viewer }) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.key]);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const displayName = viewer.name.trim() || viewer.email;
  const isEditor = roleAtLeast(viewer.role, "editor");
  return (
    <div className="account-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className="account-menu__button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <AccountAvatar name={viewer.name} email={viewer.email} image={viewer.image} />
        <span className="visually-hidden">Account menu: </span>
        <span className="account-menu__name">{displayName}</span>
        <svg className="account-menu__chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div id={panelId} className="account-menu__panel" hidden={!open}>
        <div className="account-menu__who">
          <strong>{displayName}</strong>
          <span className="muted">{viewer.email}</span>
          <span className="account-menu__role">{ROLE_LABEL[viewer.role]}</span>
        </div>
        <ul className="account-menu__links">
          <li>
            <Link to="/saved">Saved</Link>
          </li>
          {isEditor ? (
            <>
              <li className="account-menu__group">
                <Link to="/editor">Editor</Link>
              </li>
              <li>
                <Link to="/editor/homepage">Homepage layout</Link>
              </li>
            </>
          ) : null}
          {viewer.role === "owner" ? (
            <li>
              <Link to="/owner">Owner console</Link>
            </li>
          ) : null}
          <li className="account-menu__group">
            <Link to="/account">Account</Link>
          </li>
          <li>
            <Link to="/settings">Settings</Link>
          </li>
          <li>
            <button
              type="button"
              disabled={signingOut}
              onClick={async () => {
                setSigningOut(true);
                try {
                  await authClient.signOut();
                } finally {
                  window.location.assign("/");
                }
              }}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}
