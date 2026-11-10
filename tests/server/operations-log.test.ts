// Bounded publishing-failure log and audit events.
import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditEvents, publishingFailures } from "../../server/db/schema";
import { agentFor, memberActor, storyInput, testClock } from "../helpers/publishing";
import { createTestServices } from "../helpers/services";

const owner = (userId: string) => ({ userId, role: "owner" as const, status: "active" as const });

describe("publishing failures", () => {
  it("keeps 30 days, prunes on write, and is owner-only", async () => {
    const clock = testClock();
    const services = createTestServices({ now: clock.now });
    const base = { userId: null, credentialKind: null, credentialId: null, operation: "create_publication", status: "invalid", externalId: null };
    await services.publishingFailures.record({ ...base, message: "old (test)" });
    clock.advance(31 * 24 * 3600 * 1000);
    await services.publishingFailures.record({ ...base, message: "new (test)".padEnd(900, "x") });
    const [n] = await services.db.select({ n: count() }).from(publishingFailures);
    expect(n!.n).toBe(1);
    const list = await services.publishingFailures.listRecent(owner("o"));
    expect(list?.map((f) => f.message.slice(0, 10))).toEqual(["new (test)"]);
    expect(list?.[0]!.message.length).toBe(500);
    expect(await services.publishingFailures.listRecent({ role: "editor", status: "active" })).toBeNull();
    expect(await services.publishingFailures.listRecent({ role: "owner", status: "disabled" })).toBeNull();
  });

  it("never fails the caller when the log write fails", async () => {
    const services = createTestServices();
    services.sqlite.exec("DROP TABLE publishing_failures");
    const editor = await memberActor(services, "editor@example.test");
    const out = await services.publications.create(agentFor(editor), { externalId: "x", type: "story" });
    expect(!out.ok && out.status).toBe("invalid");
  });
});

describe("audit events", () => {
  it("records publishing and layout actions without content", async () => {
    const services = createTestServices();
    const editor = await memberActor(services, "editor@example.test");
    const created = await services.publications.create(agentFor(editor, { credentialId: "key-9" }), storyInput({ summary: "Secret-ish summary (test)." }));
    if (!created.ok) throw new Error(created.message);
    await services.publications.unpublish(editor, created.value.publication.id, 1);
    await services.homepage.setLayout(editor, []);
    const rows = await services.db.select().from(auditEvents);
    expect(rows.map((r) => r.action).sort()).toEqual(["homepage.update", "publication.create", "publication.unpublish"]);
    const create = rows.find((r) => r.action === "publication.create")!;
    expect(create).toMatchObject({ actorKind: "agent", credentialId: "key-9", targetType: "publication", targetId: created.value.publication.id });
    expect(JSON.stringify(rows)).not.toContain("Secret-ish");
    expect(await services.audit.listRecent({ role: "editor", status: "active" })).toBeNull();
    expect(await services.audit.listRecent(owner("o"))).toHaveLength(3);
  });
});
