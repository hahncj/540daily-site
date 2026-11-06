import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Belt and braces for the ESLint core-isolation rule: core imports only zod and other core files.
describe("server/core isolation", () => {
  it("imports only zod and relative core modules", () => {
    const dir = path.resolve("server/core");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const source = readFileSync(path.join(dir, file), "utf8");
      for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
        const spec = match[1]!;
        const allowed = spec === "zod" || (spec.startsWith("./") && !spec.includes(".."));
        expect(allowed, `${file} imports ${spec}`).toBe(true);
      }
    }
  });
});
