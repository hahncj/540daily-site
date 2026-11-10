// Seeds the Playwright test host's SQLite file through the real core services (the agent and editor
// interfaces arrive in lanes 2A and 2C). Every publication here is labeled test data, not real news.
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { writeFileSync } from "node:fs";
import { FsMediaStore } from "../../hosting/node/fs-media";
import { createServices } from "../../server/app";
import { loadConfig } from "../../server/config";
import type { AgentActor, MemberActor } from "../../server/core/actors";
import { publicationPath } from "../../server/core/publications";
import * as schema from "../../server/db/schema";

import { E2E_DIR, SEED_FILE, type SeedInfo } from "./seed-info";

/** A real 1×1 PNG (test data), so browsers can decode it. */
const TINY_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

export async function seedTestData(env: Record<string, string>): Promise<SeedInfo> {
  const sqlite = new Database(`${E2E_DIR}/540daily.db`);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  let clock = new Date("2026-10-01T15:00:00.000Z").getTime();
  const services = createServices({
    config: loadConfig(env, "node"),
    db,
    media: new FsMediaStore(`${E2E_DIR}/media`),
    fetchClientMetadata: fetchClientMetadataResource,
    now: () => new Date(clock),
  });
  const tick = (ms = 60_000) => {
    clock += ms;
  };

  const now = new Date(clock);
  const member = async (email: string, role: "editor" | "reader", name: string) => {
    const id = crypto.randomUUID();
    await db.insert(schema.user).values({ id, email, name, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(schema.memberships).values({ userId: id, role, status: "active", createdAt: now, updatedAt: now });
    return id;
  };
  const editor: MemberActor = { kind: "member", userId: await member("e2e-editor@example.test", "editor", "E2E Editor"), role: "editor" };
  const agent: AgentActor = { ...editor, kind: "agent", credentialKind: "api_key", credentialId: "e2e-key", label: "E2E research agent" };

  let n = 0;
  const publish = async (input: Record<string, unknown>, actor: MemberActor | AgentActor = agent) => {
    tick();
    n++;
    const out = await services.publications.create(actor, { externalId: `e2e-${n}`, summary: `Test data summary ${n}. Not real news.`, ...input }, { publish: true });
    if (!out.ok) throw new Error(`seed create failed: ${out.message} ${JSON.stringify(out.errors)}`);
    return out.value.publication;
  };
  const upload = async (altText: string) => {
    const ticket = await services.attachments.prepareUpload(agent, { mimeType: "image/png", size: TINY_PNG.byteLength, altText });
    if (!ticket.ok) throw new Error(ticket.message);
    const done = await services.attachments.completeUpload(ticket.value.token, TINY_PNG);
    if (!done.ok) throw new Error(done.message);
    return ticket.value.attachmentId;
  };

  // An old item, to show that date filters and old publications work.
  clock = new Date("2025-03-10T17:00:00.000Z").getTime();
  await publish({ type: "story", title: "Test data: archived pelican story", category: "Business" });
  clock = new Date("2026-10-01T15:00:00.000Z").getTime();

  for (let i = 1; i <= 6; i++) await publish({ type: "story", title: `Test data: technology story ${i}`, category: "Technology", tags: ["e2e"] });
  await publish({ type: "story", title: "Test data: business pelican update", category: "Business" });
  await publish({ type: "report", title: "Test data: finance briefing", category: "Finance", bodyMarkdown: "Test data report body.", tags: ["briefing"] });

  const chart = await upload("Test data chart");
  const report = await publish({
    type: "report",
    title: "Test data: pelican research report",
    category: "Technology",
    bodyMarkdown: `## Findings\n\nTest data body text about pelicans.\n\n![Test data chart](attachment:${chart})`,
    sources: [{ url: "https://example.test/source", label: "Example source (test data)" }],
  });

  const hiddenChart = await upload("Hidden test chart");
  const hidden = await publish({
    type: "story",
    title: "Test data: unpublished walrus story",
    category: "Technology",
    bodyMarkdown: `Walrus body.\n\n![Hidden test chart](attachment:${hiddenChart})`,
  });
  tick();
  const unpublished = await services.publications.unpublish(editor, hidden.id, hidden.revision);
  if (!unpublished.ok) throw new Error(unpublished.message);

  tick();
  const draft = await services.publications.create(editor, { type: "story", title: "Test data: draft narwhal", summary: "Draft (test data).", category: "Drafts Only" });
  if (!draft.ok) throw new Error(draft.message);

  // A category absent from the homepage, with more than one page of items.
  const archive = { slug: "e2e-archive", name: "E2E Archive", count: 23 };
  for (let i = 1; i <= archive.count; i++) await publish({ type: i % 3 === 0 ? "report" : "story", title: `Test data: archive item ${i}`, category: archive.name, bodyMarkdown: "Archive body (test data)." });

  sqlite.close();
  const info: SeedInfo = {
    visibleReport: { id: report.id, path: publicationPath(report), title: report.title, attachmentId: chart },
    hidden: { id: hidden.id, path: publicationPath(hidden), title: hidden.title, attachmentId: hiddenChart },
    draft: { id: draft.value.publication.id, path: `/publications/${draft.value.publication.id}` },
    archiveCategory: archive,
  };
  writeFileSync(SEED_FILE, JSON.stringify(info, null, 2));
  return info;
}
