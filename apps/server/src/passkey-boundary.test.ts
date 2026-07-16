import { describe, expect, test } from "bun:test";
import { immutablePasskeyRejection, passkeyMutationForPath } from "./passkey-policy.ts";

const now = new Date("2026-07-16T12:00:00.000Z").getTime();

describe("immutable passkey policy", () => {
  test("classifies every Better Auth passkey mutation route", () => {
    expect(passkeyMutationForPath("/api/auth/passkey/generate-register-options")).toBe("register");
    expect(passkeyMutationForPath("/api/auth/passkey/verify-registration")).toBe("register");
    expect(passkeyMutationForPath("/api/auth/passkey/update-passkey")).toBe("update");
    expect(passkeyMutationForPath("/api/auth/passkey/delete-passkey")).toBe("delete");
    expect(passkeyMutationForPath("/api/auth/passkey/generate-authenticate-options")).toBeNull();
    expect(passkeyMutationForPath("/api/auth/passkey/verify-authentication")).toBeNull();
    expect(passkeyMutationForPath("/api/auth/passkey/list-user-passkeys")).toBeNull();
  });

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

  for (const mutation of ["update", "delete"] as const) {
    test(`rejects passkey ${mutation}`, () => {
      expect(immutablePasskeyRejection(mutation, 1, new Date(now), now)).toEqual({
        error: "passkey_immutable",
        status: 409,
      });
    });
  }
});
