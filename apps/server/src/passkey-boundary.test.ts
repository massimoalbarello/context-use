import { describe, expect, test } from "bun:test";
import { immutablePasskeyRejection, passkeyMutationForPath } from "./passkey-policy.ts";

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

  test("allows the one-time setup ceremony to create the first passkey", () => {
    expect(immutablePasskeyRejection("register", 0)).toBeNull();
  });

  test("rejects every additional passkey", () => {
    expect(immutablePasskeyRejection("register", 1)).toEqual({
      error: "passkey_already_registered",
      status: 409,
    });
  });

  for (const mutation of ["update", "delete"] as const) {
    test(`rejects passkey ${mutation}`, () => {
      expect(immutablePasskeyRejection(mutation, 1)).toEqual({
        error: "passkey_immutable",
        status: 409,
      });
    });
  }
});
