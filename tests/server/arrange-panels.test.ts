// arrangePanels: which home page panels show, and in what order. Pure function; test data only.
import { describe, expect, it } from "vitest";
import { arrangePanels } from "../../server/core/categories";

const cat = (id: string) => ({ id, name: `Test ${id}`, slug: id });
const item = (categoryId: string, n: number) => ({ id: `${categoryId}-${n}`, category: cat(categoryId) });

describe("arrangePanels", () => {
  it("puts preferred categories with recent items first, then the others in recent order, and drops the rest", () => {
    // `recent` is ordered by each category's newest item: c, a, d.
    const recent = new Map([
      ["c", [item("c", 1)]],
      ["a", [item("a", 1), item("a", 2)]],
      ["d", [item("d", 1)]],
    ]);
    const panels = arrangePanels([cat("b"), cat("a"), cat("d")], recent);
    expect(panels.map((p) => p.category.id)).toEqual(["a", "d", "c"]);
    expect(panels[0]!.items.map((i) => i.id)).toEqual(["a-1", "a-2"]);
    expect(panels[2]!.category).toEqual(cat("c"));
  });

  it("ignores duplicate preferences and empty lists, and caps the panel count", () => {
    const recent = new Map([
      ["a", [item("a", 1)]],
      ["b", []],
      ["c", [item("c", 1)]],
    ]);
    expect(arrangePanels([cat("a"), cat("a"), cat("b")], recent).map((p) => p.category.id)).toEqual(["a", "c"]);
    expect(arrangePanels([], recent, 1).map((p) => p.category.id)).toEqual(["a"]);
    expect(arrangePanels([cat("a")], new Map())).toEqual([]);
  });
});
