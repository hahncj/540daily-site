// Display helpers for public pages. Dates show in Central Time so server and browser render the same text.
import { SITE_TIME_ZONE } from "../../server/core/dates";
import type { PublicationType } from "../../server/core/publications";

export const SUMMARY_PREVIEW_LENGTH = 240;

const dateFormat = new Intl.DateTimeFormat("en-US", { timeZone: SITE_TIME_ZONE, year: "numeric", month: "short", day: "numeric" });
const timeFormat = new Intl.DateTimeFormat("en-US", { timeZone: SITE_TIME_ZONE, hour: "numeric", minute: "2-digit", timeZoneName: "short" });

/**
 * Engines join and space dates differently ("Nov 6, 2026, 9:00 AM" in Node and Chromium, "Nov 6, 2026 at
 * 9:00 AM" in WebKit, sometimes with narrow no-break spaces). Server and browser must render the same
 * text or React's hydration fails, so the pieces are joined here with plain spaces.
 */
const plainSpaces = (text: string) => text.replace(/\s+/g, " ");

/** "Nov 6, 2026" in Central Time. */
export function formatDate(value: Date | string): string {
  return plainSpaces(dateFormat.format(new Date(value)));
}

/** "Nov 6, 2026, 9:00 AM CST". */
export function formatDateTime(value: Date | string): string {
  const date = new Date(value);
  return `${formatDate(date)}, ${plainSpaces(timeFormat.format(date))}`;
}

/** Machine-readable value for `<time dateTime>`. */
export function isoString(value: Date | string): string {
  return new Date(value).toISOString();
}

export const TYPE_LABEL: Record<PublicationType, string> = { story: "Story", report: "Report" };
export const TYPE_PLURAL: Record<PublicationType, string> = { story: "Stories", report: "Reports" };

/** Up to 240 characters of summary, cut at a word boundary when possible. */
export function previewSummary(summary: string, max = SUMMARY_PREVIEW_LENGTH): string {
  const text = summary.trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Parse a `page` query value; anything invalid is page 1. */
export function pageParam(value: string | null): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 10_000) : 1;
}
