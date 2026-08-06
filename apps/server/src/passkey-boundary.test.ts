import { describe, expect, test } from "bun:test";
import {
  immutablePasskeyRejection,
  ownerAuthenticationLockForPath,
  passkeyMutationForPath,
  whileOwnerAuthenticationLockHeld,
} from "./passkey-policy.ts";

describe("owner authentication policy", () => {
  test("classifies every Better Auth passkey mutation route", () => {
    expect(passkeyMutationForPath("/api/auth/passkey/generate-register-options")).toBe("register");
    expect(passkeyMutationForPath("/api/auth/passkey/verify-registration")).toBe("register");
    expect(passkeyMutationForPath("/api/auth/passkey/update-passkey")).toBe("update");
    expect(passkeyMutationForPath("/api/auth/passkey/delete-passkey")).toBe("delete");
    expect(passkeyMutationForPath("/api/auth/passkey/generate-authenticate-options")).toBeNull();
    expect(passkeyMutationForPath("/api/auth/passkey/verify-authentication")).toBeNull();
    expect(passkeyMutationForPath("/api/auth/passkey/list-user-passkeys")).toBeNull();
  });

  test("holds the owner advisory lock across both passkey verification handlers", () => {
    expect(ownerAuthenticationLockForPath("/api/auth/passkey/verify-authentication"))
      .toBe("passkey-authentication");
    expect(ownerAuthenticationLockForPath("/api/auth/passkey/verify-registration"))
      .toBe("passkey-registration");
    expect(ownerAuthenticationLockForPath("/api/auth/passkey/generate-authenticate-options")).toBeNull();
    expect(ownerAuthenticationLockForPath("/api/auth/passkey/generate-register-options")).toBeNull();
  });

  test("holds the owner advisory lock across every OAuth token grant", () => {
    expect(ownerAuthenticationLockForPath("/api/auth/oauth2/token")).toBe("oauth-token");
    expect(ownerAuthenticationLockForPath("/api/auth/oauth2/authorize")).toBeNull();
    expect(ownerAuthenticationLockForPath("/api/auth/oauth2/revoke")).toBeNull();
  });

  test("releases the owner lock only after session-producing handler work completes", async () => {
    const calls: string[] = [];
    const result = await whileOwnerAuthenticationLockHeld(async () => {
      calls.push("handler-start");
      await Promise.resolve();
      calls.push("handler-finished");
      return "session-created";
    }, async () => {
      calls.push("lock-released");
    });

    expect(result).toBe("session-created");
    expect(calls).toEqual(["handler-start", "handler-finished", "lock-released"]);
  });

  test("releases the owner lock when verification fails", async () => {
    const calls: string[] = [];
    await expect(whileOwnerAuthenticationLockHeld(async () => {
      calls.push("handler-failed");
      throw new Error("verification failed");
    }, async () => {
      calls.push("lock-released");
    })).rejects.toThrow("verification failed");
    expect(calls).toEqual(["handler-failed", "lock-released"]);
  });

  test("allows the one-time setup ceremony to create the first passkey", () => {
    expect(immutablePasskeyRejection("register", 0)).toBeNull();
  });

  test("leaves additional registration authorization to confirmed enrollment claims", () => {
    expect(immutablePasskeyRejection("register", 1)).toBeNull();
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
