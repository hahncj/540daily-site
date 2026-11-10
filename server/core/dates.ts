// Calendar dates in America/Chicago. Timestamps are stored in UTC; date filters are inclusive Chicago days.
// Uses the global Intl API (available on Workers and Node), no imports.

export const SITE_TIME_ZONE = "America/Chicago";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse `YYYY-MM-DD`. Returns null for anything else, including impossible dates like 2026-02-30. */
export function parseCalendarDate(value: string): { year: number; month: number; day: number } | null {
  const m = DATE_RE.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function zonedParts(epochMs: number, timeZone: string) {
  const parts: Record<string, number> = {};
  for (const p of partsFormatter(timeZone).formatToParts(new Date(epochMs))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return parts as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Offset of the zone from UTC at `epochMs`, in milliseconds (Chicago: -5h or -6h). */
function zoneOffsetMs(epochMs: number, timeZone: string): number {
  const p = zonedParts(epochMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/** UTC instant of local midnight at the start of the given calendar day in `timeZone`. */
export function startOfZonedDay(date: { year: number; month: number; day: number }, timeZone = SITE_TIME_ZONE): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day);
  let t = guess - zoneOffsetMs(guess, timeZone);
  const second = zoneOffsetMs(t, timeZone);
  if (guess - second !== t) t = guess - second; // DST changed between guess and result
  return new Date(t);
}

/**
 * Inclusive Chicago date range → half-open UTC bounds `[from, toExclusive)`. Either end may be omitted.
 */
export function chicagoDateRangeToUtc(from?: string, to?: string): { from?: Date; toExclusive?: Date } {
  const out: { from?: Date; toExclusive?: Date } = {};
  if (from) {
    const d = parseCalendarDate(from);
    if (d) out.from = startOfZonedDay(d);
  }
  if (to) {
    const d = parseCalendarDate(to);
    if (d) {
      const next = new Date(Date.UTC(d.year, d.month - 1, d.day + 1));
      out.toExclusive = startOfZonedDay({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() });
    }
  }
  return out;
}

/** The Chicago calendar date (`YYYY-MM-DD`) of an instant. */
export function chicagoDate(instant: Date): string {
  const p = zonedParts(instant.getTime(), SITE_TIME_ZONE);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Shown next to date filters in the UI and documented for integrations. */
export const DATE_BASIS_NOTE = "Dates are the day 540 Daily first published the item, in Central Time (America/Chicago).";
