/**
 * Plain-language causes for a passkey ceremony that did not end in a session.
 *
 * Three vocabularies reach the browser: WebAuthn's codes when the device
 * declines, Better Auth's when a passkey endpoint rejects, and this server's
 * `{ error }` bodies from the owner-authentication boundary. Each is answered
 * with what happened and what to do next, because the owner cannot act on
 * "Authentication failed" — the one thing Better Auth says for every cause it
 * catches, including an installation whose owner record has gone missing.
 */
const CAUSES: Record<string, string> = {
  // The device declined or had nothing to offer. WebAuthn deliberately refuses
  // to say which, so this covers both without guessing.
  AUTH_CANCELLED: "No passkey was used. Your device either has none for this installation or the request was dismissed — try again and confirm when it asks.",
  REGISTRATION_CANCELLED: "No passkey was created. Your device dismissed the request — try again and confirm when it asks.",
  ERROR_CEREMONY_ABORTED: "The request was dismissed before a passkey was used. Try again and confirm when your device asks.",
  ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED: "This device already holds a passkey for this installation. Sign in with it instead of creating another.",
  ERROR_INVALID_DOMAIN: "This page's address is not one passkeys can be used from. Open the installation at its configured address and try again.",
  ERROR_INVALID_RP_ID: "This page's address does not match the one your passkey was registered for. Open the installation at its configured address and try again.",
  ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT: "This device cannot verify it is you, which this installation requires. Use a device with a PIN, fingerprint, or face unlock.",
  ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT: "This device cannot store a passkey for this installation. Use a device or password manager that supports passkeys.",

  // Better Auth's passkey endpoints.
  CHALLENGE_NOT_FOUND: "This sign-in attempt expired before your device answered. Try again.",
  PASSKEY_NOT_FOUND: "That passkey is not registered with this installation. Use the passkey you created for it.",
  AUTHENTICATION_FAILED: "Your passkey could not be verified. Try again, and check this is the installation you registered it with.",
  UNABLE_TO_CREATE_SESSION: "Your passkey was verified, but the session could not be created. Try again.",
  FAILED_TO_VERIFY_REGISTRATION: "Your new passkey could not be verified. Try creating it again.",
  PREVIOUSLY_REGISTERED: "This device already holds a passkey for this installation.",
  YOU_ARE_NOT_ALLOWED_TO_REGISTER_THIS_PASSKEY: "This installation would not accept that passkey.",

  // Raised by this server once the passkey itself has been verified.
  USER_VERIFICATION_REQUIRED: "Your device did not verify it was you. Unlock it with your PIN, fingerprint, or face and try again.",
  OWNER_IDENTITY_MISSING: "This installation has lost its owner record, so it cannot sign anyone in. Its database needs restoring before a passkey will work.",
  OWNER_IDENTITY_MISMATCHED: "This installation's owner no longer matches the email it was deployed with, so it cannot sign you in.",

  // The owner-authentication boundary, which answers with `{ error }`.
  passkey_authentication_in_progress: "Another sign-in is already under way. Wait a moment and try again.",
  passkey_registration_in_progress: "A passkey is being registered right now. Wait a moment and try again.",
  confirmed_passkey_enrollment_required: "Creating a passkey needs an invitation confirmed from Settings on a device that is already signed in.",
  passkey_enrollment_mismatch: "This invitation was issued for a different passkey name or device. Start a new one from Settings.",
  passkey_immutable: "Passkeys cannot be changed once they are registered.",
  owner_session_required: "You need to be signed in to do that.",
  temporarily_unavailable: "Owner authentication is being changed right now. Try again in a moment.",
  not_found: "This installation did not recognise that request. Reload the page — it may be running a newer version than this one.",
};

function completeSentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export function continuesOAuthAuthorization(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const value = data as Record<string, unknown>;
  return value.redirect === true && typeof value.url === "string";
}

/** A verified ceremony answers with the session it created. */
export function establishedSession(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const value = data as Record<string, unknown>;
  return Boolean(value.session ?? value.token ?? value.user);
}

/**
 * What to tell the owner about a rejected ceremony. A named cause wins; failing
 * that the server's own wording is already written for a person, and only a
 * response carrying neither falls back to the caller's sentence.
 */
export function failureMessage(error: unknown, fallback: string): string {
  const detail = (error && typeof error === "object" ? error : {}) as Record<string, unknown>;
  const code = typeof detail.code === "string" ? detail.code : "";
  const boundary = typeof detail.error === "string" ? detail.error : "";
  const named = CAUSES[code] ?? CAUSES[boundary];
  if (named) return named;
  // An unrecognised WebAuthn code is still the device declining, and its
  // message is always the same unhelpful "Auth cancelled".
  if (code.startsWith("ERROR_")) return CAUSES.AUTH_CANCELLED!;
  const message = typeof detail.message === "string" ? detail.message.trim() : "";
  return message ? completeSentence(message) : fallback;
}

export function thrownFailureMessage(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message.trim() : "";
  return message ? completeSentence(message) : fallback;
}
