import { describe, expect, test } from "bun:test";
import { immutablePasskeyRejection } from "./passkey-policy.ts";

const now = new Date("2026-07-16T12:00:00.000Z").getTime();

describe("immutable passkey policy", () => {
  test("allows the first passkey during a fresh owner session", () => {
    expect(immutablePasskeyRejection("register", 0, new Date(now - 60_000), now)).toBeNull();
  });

  test("rejects first enrollment outside the fresh-session window", () => {
    expect(immutablePasskeyRejection("register", 0, new Date(now - 600_001), now)).toEqual({
      error: "fresh_session_required",
      status: 403,
    });
    expect(immutablePasskeyRejection("register", 0, undefined, now)).toEqual({
      error: "fresh_session_required",
      status: 403,
    });
  });

  test("rejects every additional passkey", () => {
    expect(immutablePasskeyRejection("register", 1, new Date(now), now)).toEqual({
      error: "passkey_already_registered",
      status: 409,
    });
  });

  test("rejects deletion regardless of how many passkeys exist", () => {
    expect(immutablePasskeyRejection("delete", 1, new Date(now), now)).toEqual({
      error: "passkey_immutable",
      status: 409,
    });
    expect(immutablePasskeyRejection("delete", 2, new Date(now), now)).toEqual({
      error: "passkey_immutable",
      status: 409,
    });
  });
});
