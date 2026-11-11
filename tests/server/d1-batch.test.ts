// Runs the multi-step write paths on real D1 (Miniflare, in memory) instead of better-sqlite3.
// D1 executes atomic() as a batch, a different code path from the SQLite transaction the other tests use.
import { drizzle } from "drizzle-orm/d1";
import { migrate } from "drizzle-orm/d1/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { createServices, type Services } from "../../server/app";
import { fetchClientMetadataViaFetch } from "../../server/auth/cimd-fetch";
import { loadConfig } from "../../server/config";
import * as schema from "../../server/db/schema";
import { MemoryMediaStore } from "../helpers/memory-media";
import { memberActor, storyInput } from "../helpers/publishing";
import { createMember } from "../helpers/services";

let services: Services;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: "hosting/cloudflare/wrangler.jsonc", persist: false });
  dispose = proxy.dispose;
  const db = drizzle(proxy.env.DB, { schema });
  await migrate(db, { migrationsFolder: "db/migrations" });
  const config = loadConfig(
    {
      PUBLIC_BASE_URL: "http://localhost:5173",
      OWNER_EMAIL: "owner@example.test",
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
      GOOGLE_CLIENT_ID: "test-google-client-id",
      GOOGLE_CLIENT_SECRET: "test-google-client-secret",
    },
    "node",
  );
  services = createServices({ config, db, media: new MemoryMediaStore(), fetchClientMetadata: fetchClientMetadataViaFetch });
}, 60_000);

afterAll(async () => {
  await dispose?.();
});

describe("multi-step writes on D1", () => {
  it("first dashboard visit copies the homepage layout", async () => {
    const userId = await createMember(services, "reader@example.test", "reader");
    const { panels } = await services.preferences.dashboard(userId);
    expect(panels.length).toBeGreaterThan(0);
    const again = await services.preferences.dashboard(userId);
    expect(again.panels).toEqual(panels);
  });

  it("dashboard panel and interest changes save", async () => {
    const userId = await createMember(services, "reader2@example.test", "reader");
    const { panels } = await services.preferences.dashboard(userId);
    const reordered = [...panels].reverse().map((p) => p.id);
    const saved = await services.preferences.setPanels(userId, reordered);
    expect(saved.ok && saved.value.map((p) => p.id)).toEqual(reordered);
    expect((await services.preferences.setInterestTags(userId, [])).ok).toBe(true);
  });

  it("stories can be created, updated, unpublished, restored, and rolled back", async () => {
    const editor = await memberActor(services, "editor@example.test", "editor");
    const created = await services.publications.create(editor, storyInput({ tags: ["Test tag"] }), { publish: true });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.publication.id;

    // D1 counts rows changed by the search-index triggers, so a real update must not look stale.
    const updated = await services.publications.update(editor, id, { expectedRevision: 1, title: "Updated test story", tags: ["Other tag"] });
    expect(updated).toMatchObject({ ok: true, value: { revision: 2 } });

    const stale = await services.publications.update(editor, id, { expectedRevision: 1, title: "Stale edit" });
    expect(stale).toMatchObject({ ok: false, status: "conflict" });

    expect(await services.publications.unpublish(editor, id, 2)).toMatchObject({ ok: true, value: { revision: 3, status: "unpublished" } });
    expect(await services.publications.getPublic(id)).toBeNull();
    expect(await services.publications.restoreVisibility(editor, id, 3)).toMatchObject({ ok: true, value: { revision: 4, status: "published" } });

    expect(await services.publications.restoreRevision(editor, id, 1, 4)).toMatchObject({ ok: true, value: { revision: 5 } });
    const history = await services.publications.history(editor, id);
    expect(history.ok && history.value.length).toBe(5);

    const found = await services.search.publicSearch({ q: "Test story" });
    expect(JSON.stringify(found)).toContain(id);
  });
});
