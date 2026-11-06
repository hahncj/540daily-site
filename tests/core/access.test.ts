import { describe, expect, it } from "vitest";
import { decideSignIn, hasRole, normalizeEmail, roleAtLeast } from "../../server/core/access";

const owner = "owner@example.test";

describe("membership gate rules (A2)", () => {
  it("A2: the configured owner email is allowed, case-insensitively", () => {
    expect(decideSignIn({ email: "Owner@Example.TEST", emailVerified: true, ownerEmail: owner, member: null, invitation: null })).toMatchObject({
      allow: true,
      role: "owner",
      via: "owner",
    });
  });

  it("A2: an uninvited email is refused", () => {
    expect(decideSignIn({ email: "stranger@example.test", emailVerified: true, ownerEmail: owner, member: null, invitation: null })).toEqual({
      allow: false,
      reason: "not_invited",
    });
  });

  it("A2: an open invitation allows the invited role", () => {
    expect(
      decideSignIn({ email: "reader@example.test", emailVerified: true, ownerEmail: owner, member: null, invitation: { id: "inv-1", role: "reader" } }),
    ).toEqual({ allow: true, role: "reader", via: "invitation", invitationId: "inv-1" });
  });

  it("A2: unverified emails are refused, even the owner's", () => {
    expect(decideSignIn({ email: owner, emailVerified: false, ownerEmail: owner, member: null, invitation: null })).toEqual({
      allow: false,
      reason: "email_not_verified",
    });
  });

  it("A2: disabled members are refused", () => {
    expect(
      decideSignIn({ email: "x@example.test", emailVerified: true, ownerEmail: owner, member: { role: "editor", status: "disabled" }, invitation: null }),
    ).toEqual({ allow: false, reason: "account_disabled" });
  });

  it("existing active members keep their current role", () => {
    expect(
      decideSignIn({ email: "e@example.test", emailVerified: true, ownerEmail: owner, member: { role: "editor", status: "active" }, invitation: null }),
    ).toMatchObject({ allow: true, role: "editor", via: "member" });
  });
});

describe("roles", () => {
  it("rank reader < editor < owner", () => {
    expect(roleAtLeast("reader", "editor")).toBe(false);
    expect(roleAtLeast("editor", "editor")).toBe(true);
    expect(roleAtLeast("owner", "editor")).toBe(true);
    expect(roleAtLeast("editor", "owner")).toBe(false);
  });

  it("disabled members have no role", () => {
    expect(hasRole({ role: "owner", status: "disabled" }, "reader")).toBe(false);
    expect(hasRole({ role: "reader", status: "active" }, "reader")).toBe(true);
  });

  it("normalizes email case and whitespace without Gmail alias rewriting", () => {
    expect(normalizeEmail("  First.Last+news@Gmail.com ")).toBe("first.last+news@gmail.com");
  });
});
