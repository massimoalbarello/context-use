import { describe, expect, test } from "bun:test";
import {
  continuesOAuthAuthorization,
  establishedSession,
  failureMessage,
  thrownFailureMessage,
} from "./login-feedback.ts";

const FALLBACK = "Sign-in failed. Try again.";

describe("passkey sign-in feedback", () => {
  test("names the installation fault behind a swallowed authentication failure", () => {
    // Better Auth answers "Authentication failed" for every cause it catches,
    // so the auth service raises this before the session insert can fail.
    expect(failureMessage({ code: "OWNER_IDENTITY_MISSING", message: "This installation has no owner identity", status: 500 }, FALLBACK))
      .toBe("This installation has lost its owner record, so it cannot sign anyone in. Its database needs restoring before a passkey will work.");
    expect(failureMessage({ code: "OWNER_IDENTITY_MISMATCHED", status: 500 }, FALLBACK))
      .toBe("This installation's owner no longer matches the email it was deployed with, so it cannot sign you in.");
  });

  test("says what each passkey endpoint rejection means", () => {
    expect(failureMessage({ code: "PASSKEY_NOT_FOUND", message: "Passkey not found", status: 401 }, FALLBACK))
      .toBe("That passkey is not registered with this installation. Use the passkey you created for it.");
    expect(failureMessage({ code: "CHALLENGE_NOT_FOUND", message: "Challenge not found", status: 400 }, FALLBACK))
      .toBe("This sign-in attempt expired before your device answered. Try again.");
    expect(failureMessage({ code: "USER_VERIFICATION_REQUIRED", status: 403 }, FALLBACK))
      .toBe("Your device did not verify it was you. Unlock it with your PIN, fingerprint, or face and try again.");
  });

  test("translates the owner-authentication boundary's error bodies", () => {
    expect(failureMessage({ error: "passkey_authentication_in_progress", status: 409 }, FALLBACK))
      .toBe("Another sign-in is already under way. Wait a moment and try again.");
    // These bodies carry a terse `message` alongside the code; the code wins.
    expect(failureMessage({ error: "not_found", message: "Not found", status: 404 }, FALLBACK))
      .toBe("This installation did not recognise that request. Reload the page — it may be running a newer version than this one.");
    expect(failureMessage({ error: "confirmed_passkey_enrollment_required", status: 403 }, FALLBACK))
      .toBe("Creating a passkey needs an invitation confirmed from Settings on a device that is already signed in.");
  });

  test("covers both reasons a device produced no passkey", () => {
    for (const code of ["AUTH_CANCELLED", "ERROR_CEREMONY_ABORTED", "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY"]) {
      expect(failureMessage({ code, message: "Auth cancelled", status: 400 }, FALLBACK))
        .toMatch(/^(No passkey was used|The request was dismissed)/);
    }
    expect(failureMessage({ code: "ERROR_INVALID_RP_ID", message: "Auth cancelled", status: 400 }, FALLBACK))
      .toBe("This page's address does not match the one your passkey was registered for. Open the installation at its configured address and try again.");
  });

  test("keeps the server's own wording when it has no code to translate", () => {
    expect(failureMessage({ message: "The passkey enrollment is expired or already used", status: 409 }, FALLBACK))
      .toBe("The passkey enrollment is expired or already used.");
    expect(failureMessage({ message: "Invalid owner setup claim.", status: 403 }, FALLBACK))
      .toBe("Invalid owner setup claim.");
  });

  test("falls back only when the rejection carries nothing at all", () => {
    expect(failureMessage(null, FALLBACK)).toBe(FALLBACK);
    expect(failureMessage({ status: 500 }, FALLBACK)).toBe(FALLBACK);
  });

  test("never leaks a status code or a log-reading instruction", () => {
    const rejections = [
      { code: "AUTHENTICATION_FAILED", message: "Authentication failed", status: 400 },
      { error: "passkey_immutable", status: 409 },
      { message: "Something odd", status: 503 },
      {},
    ];
    for (const rejection of rejections) {
      const shown = failureMessage(rejection, FALLBACK);
      expect(shown).not.toMatch(/HTTP|\b\d{3}\b|server log/i);
    }
  });

  test("reports what a thrown ceremony failure said", () => {
    expect(thrownFailureMessage(new Error("Failed to fetch"), FALLBACK)).toBe("Failed to fetch.");
    expect(thrownFailureMessage("nope", FALLBACK)).toBe(FALLBACK);
  });

  test("treats only a session-bearing response as signed in", () => {
    expect(establishedSession({ session: { id: "s" }, user: { id: "context-use-owner" } })).toBe(true);
    expect(establishedSession({ token: "t" })).toBe(true);
    expect(establishedSession({})).toBe(false);
    expect(establishedSession(null)).toBe(false);
  });

  test("leaves an OAuth continuation to the provider redirect", () => {
    expect(continuesOAuthAuthorization({ redirect: true, url: "/app/oauth/consent" })).toBe(true);
    expect(continuesOAuthAuthorization({ redirect: true })).toBe(false);
    expect(continuesOAuthAuthorization({ session: { id: "s" } })).toBe(false);
  });
});
