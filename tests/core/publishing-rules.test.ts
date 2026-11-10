// Pure core rules: names, slugs, Chicago dates, search expressions, actors, layout moves.
import { describe, expect, it } from "vitest";
import { canCreatePublication, canEdit, canUpdatePublication } from "../../server/core/actors";
import { moveCategory } from "../../server/core/categories";
import { chicagoDate, chicagoDateRangeToUtc, parseCalendarDate } from "../../server/core/dates";
import { canonicalJson } from "../../server/core/hash";
import { displayName, normalizedName, slugify, uniqueNames, uniqueSlug } from "../../server/core/names";
import { attribution, publicationPath } from "../../server/core/publications";
import { toMatchExpression } from "../../server/core/search";

describe("names and slugs", () => {
  it("normalizes Unicode, whitespace, and case", () => {
    expect(displayName("  Ｔｅｃｈ  News \n")).toBe("Tech News");
    expect(normalizedName("ÉCOLE  Café")).toBe("école café");
    expect(normalizedName("Café")).toBe(normalizedName("Café"));
    expect(uniqueNames(["AI", "ai", " A I ", "Ai"])).toEqual(["AI", "A I"]);
  });

  it("makes ASCII slugs with fallbacks and collision suffixes", () => {
    expect(slugify("Crème Brûlée & Co.")).toBe("creme-brulee-co");
    expect(slugify("日本語", "category")).toBe("category");
    expect(slugify("a".repeat(100)).length).toBeLessThanOrEqual(60);
    expect(uniqueSlug("c", new Set(["c", "c-2"]))).toBe("c-3");
    expect(uniqueSlug("c", new Set())).toBe("c");
  });
});

describe("America/Chicago dates", () => {
  it("parses only real calendar dates", () => {
    expect(parseCalendarDate("2026-02-28")).toEqual({ year: 2026, month: 2, day: 28 });
    expect(parseCalendarDate("2026-02-29")).toBeNull();
    expect(parseCalendarDate("2026-2-1")).toBeNull();
  });

  it("converts inclusive days to UTC bounds across DST", () => {
    expect(chicagoDateRangeToUtc("2026-01-15", "2026-01-15")).toEqual({
      from: new Date("2026-01-15T06:00:00.000Z"),
      toExclusive: new Date("2026-01-16T06:00:00.000Z"),
    });
    expect(chicagoDateRangeToUtc("2026-07-04").from).toEqual(new Date("2026-07-04T05:00:00.000Z"));
    // DST starts 2026-03-08 and ends 2026-11-01 in the US.
    expect(chicagoDateRangeToUtc("2026-03-08", "2026-03-08")).toEqual({
      from: new Date("2026-03-08T06:00:00.000Z"),
      toExclusive: new Date("2026-03-09T05:00:00.000Z"),
    });
    expect(chicagoDateRangeToUtc(undefined, "2026-11-01").toExclusive).toEqual(new Date("2026-11-02T06:00:00.000Z"));
    expect(chicagoDateRangeToUtc("2026-12-31", "2026-12-31").toExclusive).toEqual(new Date("2027-01-01T06:00:00.000Z"));
  });

  it("formats an instant as its Chicago date", () => {
    expect(chicagoDate(new Date("2026-11-07T04:30:00.000Z"))).toBe("2026-11-06");
    expect(chicagoDate(new Date("2026-11-07T06:30:00.000Z"))).toBe("2026-11-07");
  });
});

describe("search expressions", () => {
  it("quotes letter/digit terms joined with AND", () => {
    expect(toMatchExpression('Climate "change" OR NEAR(x)')).toBe('"climate" AND "change" AND "or" AND "near" AND "x"');
    expect(toMatchExpression("  ***  ")).toBeNull();
    expect(toMatchExpression(undefined)).toBeNull();
    expect(toMatchExpression("a b c d e f g h i j k l m n")!.split(" AND ")).toHaveLength(12);
  });
});

describe("actors", () => {
  const editorAgent = { kind: "agent" as const, userId: "u1", role: "editor" as const, credentialKind: "api_key" as const, credentialId: "k", label: "Bot" };
  it("applies the agent guardrails", () => {
    expect(canCreatePublication(editorAgent)).toBe(true);
    expect(canCreatePublication({ ...editorAgent, role: "reader" })).toBe(false);
    expect(canUpdatePublication(editorAgent, "u1")).toBe(true);
    expect(canUpdatePublication(editorAgent, "u2")).toBe(false);
    expect(canUpdatePublication({ ...editorAgent, role: "owner" }, "u2")).toBe(false);
    expect(canUpdatePublication({ kind: "member", userId: "u1", role: "editor" }, "u2")).toBe(true);
    expect(canEdit(editorAgent)).toBe(false);
    expect(canEdit({ kind: "member", userId: "u1", role: "reader" })).toBe(false);
  });
});

describe("helpers", () => {
  it("builds paths, attribution, layout moves, and canonical JSON", () => {
    expect(publicationPath({ id: "abc", title: "Hello, World!" })).toBe("/publications/abc/hello-world");
    expect(attribution({ userId: "u", name: "Pat", kind: "agent", label: "Research Bot" })).toBe("Pat via Research Bot");
    expect(attribution({ userId: "u", name: "Pat", kind: "member", label: null })).toBe("Pat");
    expect(moveCategory(["a", "b", "c"], "c", "up")).toEqual(["a", "c", "b"]);
    expect(moveCategory(["a", "b", "c"], "a", "up")).toEqual(["a", "b", "c"]);
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[2,{"y":2,"z":1}]},"b":1}');
  });
});
