import { describe, expect, test } from "bun:test";
import { isVerifiedOwner } from "./owner.ts";

describe("single verified owner identity", () => {
  test("requires the exact normalized allowlisted email and provider verification", () => {
    expect(isVerifiedOwner("OWNER@EXAMPLE.COM", true)).toBe(true);
    expect(isVerifiedOwner(" owner@example.com ", true)).toBe(true);
    expect(isVerifiedOwner("owner@example.com", false)).toBe(false);
    expect(isVerifiedOwner("attacker@example.com", true)).toBe(false);
    expect(isVerifiedOwner(null, true)).toBe(false);
  });
});
