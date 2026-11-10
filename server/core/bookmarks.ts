// Private bookmarks. Each resolves to the current published version; an unpublished or draft item shows
// only a generic "unavailable" entry, never its title or content. Every method takes the signed-in
// member's own user ID; callers never pass another member's ID.
import type { Page, PublicationListItem } from "./publications";
import { PAGE_SIZE } from "./publications";
import { fail, ok, type Result } from "./result";

export const MAX_BOOKMARKS = 2000;

export type SavedEntry =
  | { kind: "available"; publicationId: string; savedAt: Date; item: PublicationListItem }
  | { kind: "unavailable"; publicationId: string; savedAt: Date };

export interface BookmarksRepository {
  /** True when the publication exists and is published right now. */
  isPublished(publicationId: string): Promise<boolean>;
  count(userId: string): Promise<number>;
  /** Insert if missing; an existing bookmark keeps its saved time. */
  add(userId: string, publicationId: string, now: Date): Promise<void>;
  remove(userId: string, publicationId: string): Promise<void>;
  /**
   * The member's bookmarks, newest first. `item` is set only for publications that are published now;
   * nothing else about other items is read.
   */
  list(userId: string, limit: number, offset: number): Promise<{ entries: Array<{ publicationId: string; savedAt: Date; item: PublicationListItem | null }>; total: number }>;
  /** Which of `publicationIds` the member has saved. */
  savedAmong(userId: string, publicationIds: readonly string[]): Promise<Set<string>>;
}

export type Bookmarks = ReturnType<typeof createBookmarks>;

export function createBookmarks({ repo, now }: { repo: BookmarksRepository; now: () => Date }) {
  return {
    /** Only published items can be saved. Drafts, unpublished, and unknown IDs all look the same. */
    async save(userId: string, publicationId: string): Promise<Result<{ saved: true }>> {
      if (!publicationId || !(await repo.isPublished(publicationId))) return fail("not_found", "That publication isn't available.");
      const existing = await repo.savedAmong(userId, [publicationId]);
      if (!existing.has(publicationId) && (await repo.count(userId)) >= MAX_BOOKMARKS) {
        return fail("invalid", `You can save at most ${MAX_BOOKMARKS} items. Remove some first.`);
      }
      await repo.add(userId, publicationId, now());
      return ok({ saved: true });
    },

    /** Removing works for any of the member's own bookmarks, including unavailable ones. */
    async remove(userId: string, publicationId: string): Promise<Result<{ saved: false }>> {
      if (!publicationId) return fail("invalid", "Missing publication.");
      await repo.remove(userId, publicationId);
      return ok({ saved: false });
    },

    async list(userId: string, page = 1): Promise<Page<SavedEntry>> {
      const current = Number.isInteger(page) && page >= 1 ? Math.min(page, 10_000) : 1;
      const { entries, total } = await repo.list(userId, PAGE_SIZE, (current - 1) * PAGE_SIZE);
      const items: SavedEntry[] = entries.map((e) =>
        e.item && e.item.status === "published"
          ? { kind: "available", publicationId: e.publicationId, savedAt: e.savedAt, item: e.item }
          : { kind: "unavailable", publicationId: e.publicationId, savedAt: e.savedAt },
      );
      return { items, total, page: current, pageSize: PAGE_SIZE };
    },

    async savedAmong(userId: string, publicationIds: readonly string[]): Promise<Set<string>> {
      if (publicationIds.length === 0) return new Set();
      return repo.savedAmong(userId, [...new Set(publicationIds)]);
    },
  };
}
