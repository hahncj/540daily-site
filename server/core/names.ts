// Category and tag name normalization and URL slugs.

/** Readable display label: Unicode NFKC, trimmed, inner whitespace collapsed to one space. */
export function displayName(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

/**
 * Case-insensitive uniqueness key, stored in `normalized_name`. Lower-cased here (full Unicode),
 * because SQLite's `collate nocase` only folds ASCII.
 */
export function normalizedName(raw: string): string {
  return displayName(raw).toLowerCase();
}

const MAX_SLUG = 60;

/** URL slug: ASCII letters and digits joined by hyphens. Falls back to `fallback` when nothing is left. */
export function slugify(raw: string, fallback = "item"): string {
  const slug = raw
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "") // strip combining marks (é → e)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, "");
  return slug || fallback;
}

/**
 * First free slug for `base`: `base`, then `base-2`, `base-3`, … `taken` holds slugs already used by
 * other names. Stable: a name keeps the slug it was created with.
 */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, MAX_SLUG - String(n).length - 1)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Deduplicate names by normalized key, keeping the first display form. */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const display = displayName(name);
    const key = display.toLowerCase();
    if (!display || seen.has(key)) continue;
    seen.add(key);
    out.push(display);
  }
  return out;
}
