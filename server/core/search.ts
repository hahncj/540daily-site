// Keyword search over current published title, summary, and body (FTS5), with category, type, and
// inclusive America/Chicago date filters. Filters combine with AND. Revisions are never searched.
import { z } from "zod";
import type { Actor } from "./actors";
import { chicagoDateRangeToUtc, parseCalendarDate } from "./dates";
import { PAGE_SIZE, PUBLICATION_TYPES, type Page, type PublicationListItem, type PublicationType } from "./publications";
import { fail, fieldErrors, ok, type Result } from "./result";

export const MAX_QUERY_LENGTH = 200;
export const MAX_QUERY_TERMS = 12;

const calendarDate = z
  .string()
  .refine((v) => parseCalendarDate(v) !== null, "Use a date like 2026-11-06.")
  .describe("Calendar date in America/Chicago, inclusive.");

export const searchShape = {
  q: z.string().max(MAX_QUERY_LENGTH).optional().describe("Keywords. Matches title, summary, and body."),
  category: z.string().max(100).optional().describe("Category slug."),
  type: z.enum(PUBLICATION_TYPES).optional(),
  from: calendarDate.optional(),
  to: calendarDate.optional(),
  page: z.number().int().min(1).max(10_000).optional(),
};
export const searchSchema = z
  .strictObject(searchShape)
  .refine((s) => !s.from || !s.to || s.from <= s.to, { path: ["to"], message: "The end date is before the start date." });
export type SearchInput = z.input<typeof searchSchema>;

/**
 * Build a safe FTS5 MATCH expression from user words. Raw input never reaches MATCH: only letters and
 * digits survive, each term is quoted, and terms combine with AND. Null when no searchable words remain.
 */
export function toMatchExpression(query: string | undefined): string | null {
  if (!query) return null;
  const terms = [...new Set(query.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].slice(0, MAX_QUERY_TERMS);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t}"`).join(" AND ");
}

export type SearchFilter = {
  match: string | null;
  categoryId?: string;
  type?: PublicationType;
  from?: Date;
  toExclusive?: Date;
  /** Agent reads: also include this member's own unpublished and draft items. */
  includeOwnFor?: string;
  limit: number;
  offset: number;
};

export interface SearchRepository {
  /** With `match`: relevance (bm25), then newest. Without: newest (published_at desc, id desc). */
  search(filter: SearchFilter): Promise<{ items: PublicationListItem[]; total: number }>;
  categoryIdForSlug(slug: string): Promise<string | null>;
}

export type Search = ReturnType<typeof createSearch>;

export function createSearch({ repo }: { repo: SearchRepository }) {
  async function run(input: unknown, includeOwnFor?: string): Promise<Result<Page<PublicationListItem>>> {
    const parsed = searchSchema.safeParse(input ?? {});
    if (!parsed.success) return fail("invalid", "Invalid search.", { errors: fieldErrors(parsed.error.issues) });
    const s = parsed.data;
    const page = s.page ?? 1;
    let categoryId: string | undefined;
    if (s.category) {
      const id = await repo.categoryIdForSlug(s.category);
      if (!id) return ok({ items: [], total: 0, page, pageSize: PAGE_SIZE });
      categoryId = id;
    }
    const { from, toExclusive } = chicagoDateRangeToUtc(s.from, s.to);
    const { items, total } = await repo.search({
      match: toMatchExpression(s.q),
      categoryId,
      type: s.type,
      from,
      toExclusive,
      includeOwnFor,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    });
    return ok({ items, total, page, pageSize: PAGE_SIZE });
  }

  return {
    /** Public search: published items only. */
    publicSearch: (input: unknown) => run(input),
    /** Agent search: published items plus the acting member's own items in any status. */
    agentSearch: (actor: Actor, input: unknown) => run(input, actor.userId),
  };
}
