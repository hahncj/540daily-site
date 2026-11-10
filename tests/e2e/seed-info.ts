// What seed.setup.ts wrote, for specs to read. Kept apart from seed-data.ts so specs do not load server code.
import { readFileSync } from "node:fs";

export const E2E_DIR = ".e2e";
export const SEED_FILE = `${E2E_DIR}/seed.json`;

export type SeedInfo = {
  visibleReport: { id: string; path: string; title: string; attachmentId: string };
  hidden: { id: string; path: string; title: string; attachmentId: string };
  draft: { id: string; path: string };
  archiveCategory: { slug: string; name: string; count: number };
};

export function readSeed(): SeedInfo {
  return JSON.parse(readFileSync(SEED_FILE, "utf8")) as SeedInfo;
}
