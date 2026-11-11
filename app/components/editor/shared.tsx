// Small pieces shared by the editor pages.
import { NavLink } from "react-router";
import editorCss from "../../styles/editor.css?url";
import { formatDateTime, isoString } from "../format";

/** Editor pages are private: never indexed (the server also sends X-Robots-Tag: noindex). */
export const NOINDEX_META = { name: "robots", content: "noindex, nofollow" } as const;

export const editorLinks = () => [{ rel: "stylesheet", href: editorCss }];

const STATUS_LABEL = { draft: "Draft", published: "Published", unpublished: "Unpublished" } as const;
export type Status = keyof typeof STATUS_LABEL;

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`status-badge status-badge--${status}`}>{STATUS_LABEL[status]}</span>;
}

/** Times are shown in Central Time, the site's date basis, with the same text on server and browser. */
export function Time({ value }: { value: Date | string }) {
  return <time dateTime={isoString(value)}>{formatDateTime(value)}</time>;
}

export function EditorNav() {
  return (
    <nav className="editor-nav" aria-label="Editor">
      <ul>
        <li>
          <NavLink to="/editor" end>
            Publications
          </NavLink>
        </li>
        <li>
          <NavLink to="/editor/new">New publication</NavLink>
        </li>
        <li>
          <NavLink to="/editor/homepage">Homepage layout</NavLink>
        </li>
      </ul>
    </nav>
  );
}

/** A success message after a redirect (`?done=`). Announced politely. */
export function Flash({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="notice notice--success" role="status">
      {message}
    </p>
  );
}

export function ErrorNotice({ message, children }: { message: string | null | undefined; children?: React.ReactNode }) {
  if (!message) return null;
  return (
    <div className="notice notice--error" role="alert">
      <p>{message}</p>
      {children}
    </div>
  );
}
