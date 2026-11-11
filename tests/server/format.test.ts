// Date text must not depend on the JavaScript engine: server (Node/workerd) and browsers must match exactly.
import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "../../app/components/format";

describe("date formatting", () => {
  it("formats in Central Time with plain spaces and a comma before the time", () => {
    expect(formatDate("2026-10-01T15:00:00.000Z")).toBe("Oct 1, 2026");
    expect(formatDateTime("2026-10-01T15:00:00.000Z")).toBe("Oct 1, 2026, 10:00 AM CDT");
    expect(formatDateTime(new Date("2026-12-01T15:00:00.000Z"))).toBe("Dec 1, 2026, 9:00 AM CST");
    expect(formatDateTime("2026-12-01T15:00:00.000Z")).not.toMatch(/[  ]/);
  });
});
