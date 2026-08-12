import { describe, expect, test } from "bun:test";
import {
  continuesOAuthAuthorization,
  establishedSession,
  failureMessage,
  SIGN_IN_OUTCOMES,
} from "./login-feedback.ts";

describe("passkey sign-in feedback", () => {
  test("separates an installation that cannot sign anyone in from a passkey it refused", () => {
    // The state a stray integration-test run left behind. Better Auth reports
    // it as "Authentication failed", indistinguishable from a bad passkey, so
    // the auth service names it before the session insert can fail.
    expect(failureMessage({ code: "OWNER_IDENTITY_MISSING", status: 500 })).toBe(SIGN_IN_OUTCOMES.unavailable);
    expect(failureMessage({ code: "OWNER_IDENTITY_MISMATCHED", status: 500 })).toBe(SIGN_IN_OUTCOMES.unavailable);
    expect(failureMessage({ code: "UNABLE_TO_CREATE_SESSION", status: 500 })).toBe(SIGN_IN_OUTCOMES.unavailable);
    expect(failureMessage({ status: 503 })).toBe(SIGN_IN_OUTCOMES.unavailable);
  });

  test("tells the owner to retry when the device produced no passkey", () => {
    for (const code of ["AUTH_CANCELLED", "REGISTRATION_CANCELLED", "ERROR_CEREMONY_ABORTED", "ERROR_INVALID_RP_ID"]) {
      expect(failureMessage({ code, message: "Auth cancelled", status: 400 })).toBe(SIGN_IN_OUTCOMES.dismissed);
    }
  });

  test("treats every other rejection as a passkey this installation would not take", () => {
    const rejections = [
      { code: "PASSKEY_NOT_FOUND", message: "Passkey not found", status: 401 },
      { code: "CHALLENGE_NOT_FOUND", message: "Challenge not found", status: 400 },
      { code: "AUTHENTICATION_FAILED", message: "Authentication failed", status: 400 },
      { error: "confirmed_passkey_enrollment_required", status: 403 },
      {},
      null,
    ];
    for (const rejection of rejections) expect(failureMessage(rejection)).toBe(SIGN_IN_OUTCOMES.refused);
  });

  test("never puts a status code or an internal message on screen", () => {
    for (const outcome of Object.values(SIGN_IN_OUTCOMES)) {
      expect(outcome).not.toMatch(/HTTP|\b\d{3}\b|_[A-Z]|foreign key/i);
    }
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
