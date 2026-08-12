import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { isVerifiedOwner, ownerSessionRejection, ownerSetupContext } from "./owner.ts";

describe("single verified owner identity", () => {
  test("requires the exact normalized configured email and internal verification flag", () => {
    expect(isVerifiedOwner("OWNER@EXAMPLE.COM", true)).toBe(true);
    expect(isVerifiedOwner(" owner@example.com ", true)).toBe(true);
    expect(isVerifiedOwner("owner@example.com", false)).toBe(false);
    expect(isVerifiedOwner("attacker@example.com", true)).toBe(false);
    expect(isVerifiedOwner(null, true)).toBe(false);
  });

  test("accepts only the matching email and one-time setup token", () => {
    const token = "a".repeat(43);
    const hash = createHash("sha256").update(token).digest("hex");
    const context = JSON.stringify({ email: " OWNER@EXAMPLE.COM ", token });
    expect(ownerSetupContext(context, "owner@example.com", hash)).toEqual({ email: "owner@example.com" });
    expect(ownerSetupContext(JSON.stringify({ email: "attacker@example.com", token }), "owner@example.com", hash)).toBeNull();
    expect(ownerSetupContext(JSON.stringify({ email: "owner@example.com", token: "b".repeat(43) }), "owner@example.com", hash)).toBeNull();
    expect(ownerSetupContext(JSON.stringify({ email: "owner@example.com", token, extra: true }), "owner@example.com", hash)).toBeNull();
  });

  test("distinguishes why a verified passkey cannot be given a session", () => {
    // The state a stray integration-test run left behind: passkey and session
    // rows intact, owner row gone. Better Auth reported only "Authentication
    // failed", so the cause has to be named before the session insert.
    expect(ownerSessionRejection(null)).toEqual({
      message: "This installation has no owner identity",
      code: "OWNER_IDENTITY_MISSING",
    });
    expect(ownerSessionRejection({ email: "attacker@example.com", emailVerified: true })).toEqual({
      message: "The owner identity does not match this installation",
      code: "OWNER_IDENTITY_MISMATCHED",
    });
    expect(ownerSessionRejection({ email: "owner@example.com", emailVerified: false })).toMatchObject({
      code: "OWNER_IDENTITY_MISMATCHED",
    });
    expect(ownerSessionRejection({ email: "owner@example.com", emailVerified: true })).toBeNull();
  });
});
