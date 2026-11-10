import { useEffect, useState } from "react";
import { useFetcher, useLocation } from "react-router";
import "../styles/reader.css";

type BookmarkResult = { ok: boolean; saved?: boolean; message?: string };

/**
 * Save/unsave toggle for a signed-in member. Posts to `/saved`. With JavaScript it updates in place
 * (optimistically); without it, the form posts and returns to the same page.
 * A failed change keeps the previous state and shows a message; pressing again retries.
 */
export function BookmarkButton({ publicationId, title, saved }: { publicationId: string; title: string; saved: boolean }) {
  const fetcher = useFetcher<BookmarkResult>();
  const location = useLocation();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const pendingIntent = fetcher.formData?.get("intent");
  const isSaved = pendingIntent ? pendingIntent === "save" : saved;
  const failed = fetcher.state === "idle" && fetcher.data && !fetcher.data.ok;

  return (
    <fetcher.Form method="post" action="/saved" className="bookmark" preventScrollReset>
      <input type="hidden" name="intent" value={isSaved ? "remove" : "save"} />
      <input type="hidden" name="publicationId" value={publicationId} />
      <input type="hidden" name="next" value={location.pathname + location.search} />
      {hydrated ? <input type="hidden" name="js" value="1" /> : null}
      <button type="submit" className="button bookmark__button" aria-pressed={isSaved}>
        <span aria-hidden="true">{isSaved ? "★ Saved" : "☆ Save"}</span>
        <span className="visually-hidden">Save {title}</span>
      </button>
      {failed ? (
        <span className="bookmark__error" role="alert">
          {fetcher.data?.message ?? "Couldn't update. Try again."}
        </span>
      ) : null}
    </fetcher.Form>
  );
}
