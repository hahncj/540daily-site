import { describe, expect, it } from "vitest";
import { createMember, createTestServices } from "../helpers/services";

describe("migrations on a fresh database (A15, partial)", () => {
  it("A15: creates every auth and app table", () => {
    const { sqlite } = createTestServices();
    const tables = (sqlite.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((t) => t.name);
    for (const name of [
      "user",
      "session",
      "account",
      "verification",
      "jwks",
      "oauth_client",
      "oauth_access_token",
      "oauth_refresh_token",
      "oauth_consent",
      "memberships",
      "invitations",
      "api_keys",
      "tool_revocations",
      "categories",
      "tags",
      "homepage_panels",
      "publications",
      "publication_tags",
      "publication_revisions",
      "submission_receipts",
      "attachments",
      "upload_tickets",
      "attachment_references",
      "user_preferences",
      "user_category_panels",
      "user_interest_tags",
      "bookmarks",
      "audit_events",
      "publishing_failures",
      "rate_limit_counters",
      "publications_fts",
    ]) {
      expect(tables, name).toContain(name);
    }
  });

  it("A15: seeds the five starting categories and selects them for the homepage, in order", () => {
    const { sqlite } = createTestServices();
    const panels = sqlite
      .prepare("select c.name, c.slug, h.position from homepage_panels h join categories c on c.id = h.category_id order by h.position")
      .all();
    expect(panels).toEqual([
      { name: "Technology", slug: "technology", position: 0 },
      { name: "Business", slug: "business", position: 1 },
      { name: "Finance", slug: "finance", position: 2 },
      { name: "Sports", slug: "sports", position: 3 },
      { name: "Entertainment", slug: "entertainment", position: 4 },
    ]);
    expect(sqlite.prepare("select count(*) as n from publications").get()).toEqual({ n: 0 });
  });

  it("category names are unique case-insensitively", () => {
    const { sqlite } = createTestServices();
    expect(() =>
      sqlite.prepare("insert into categories (id, name, normalized_name, slug, created_at) values ('x', 'TECHNOLOGY', 'TECHNOLOGY', 'technology-2', 0)").run(),
    ).toThrow(/UNIQUE/);
  });

  it("submission receipts are unique per (user_id, external_id)", async () => {
    const services = createTestServices();
    const userId = await createMember(services, "editor@example.test", "editor");
    const { sqlite } = services;
    insertPublication(sqlite, "pub-1", userId, "published");
    const receipt = sqlite.prepare(
      "insert into submission_receipts (id, user_id, external_id, payload_hash, publication_id, created_at) values (?, ?, ?, 'h', 'pub-1', 0)",
    );
    receipt.run("r1", userId, "ext-1");
    expect(() => receipt.run("r2", userId, "ext-1")).toThrow(/UNIQUE/);
  });

  it("search indexes only published publications and follows status changes", async () => {
    const services = createTestServices();
    const userId = await createMember(services, "editor@example.test", "editor");
    const { sqlite } = services;
    insertPublication(sqlite, "pub-live", userId, "published", "Test data: solar battery storage");
    insertPublication(sqlite, "pub-draft", userId, "draft", "Test data: solar draft");
    const search = () =>
      (sqlite.prepare("select publication_id from publications_fts where publications_fts match 'solar' order by publication_id").all() as {
        publication_id: string;
      }[]).map((r) => r.publication_id);

    expect(search()).toEqual(["pub-live"]);
    sqlite.prepare("update publications set status = 'unpublished' where id = 'pub-live'").run();
    expect(search()).toEqual([]);
    sqlite.prepare("update publications set status = 'published' where id = 'pub-draft'").run();
    expect(search()).toEqual(["pub-draft"]);
  });

  it("only one open invitation per email (case-insensitive)", () => {
    const { sqlite } = createTestServices();
    const insert = sqlite.prepare("insert into invitations (id, email, role, created_at) values (?, ?, 'reader', 0)");
    insert.run("i1", "reader@example.test");
    expect(() => insert.run("i2", "READER@example.test")).toThrow(/UNIQUE/);
    sqlite.prepare("update invitations set revoked_at = 1 where id = 'i1'").run();
    expect(() => insert.run("i3", "reader@example.test")).not.toThrow();
  });
});

function insertPublication(sqlite: import("better-sqlite3").Database, id: string, userId: string, status: string, title = "Test data title") {
  sqlite
    .prepare(
      `insert into publications (id, type, title, summary, body_markdown, category_id, status, revision, created_by_user_id, created_by_kind, created_at, published_at, updated_at)
       values (?, 'story', ?, 'Test data summary', 'Test data body', 'seed-category-technology', ?, 1, ?, 'member', 0, 0, 0)`,
    )
    .run(id, title, status, userId);
}
