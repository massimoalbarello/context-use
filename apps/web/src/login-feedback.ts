/**
 * What a rejected passkey ceremony tells the owner. Only three outcomes change
 * what they should do next — retry, use a different passkey, or stop tapping
 * and go look at the installation — so the many codes that reach the browser
 * are sorted into those and the specifics are left to the server log.
 */
export const SIGN_IN_OUTCOMES = {
  dismissed: "No passkey was used. Your device either has none for this installation or the request was dismissed — try again and confirm when it asks.",
  refused: "This installation would not accept that passkey. Check you are using the one you registered with it.",
  unavailable: "This installation cannot sign you in right now. Its server log has the reason.",
} as const;

// Raised in the browser when the device declines: Better Auth reports every
// WebAuthn failure this way, with codes prefixed ERROR_ or AUTH_CANCELLED.
const DISMISSED = /^(AUTH_CANCELLED|REGISTRATION_CANCELLED|ERROR_)/;

// The installation is at fault, not the passkey. OWNER_IDENTITY_* comes from
// this server's own check; the rest is Better Auth failing to seat a session.
const UNAVAILABLE = new Set([
  "OWNER_IDENTITY_MISSING",
  "OWNER_IDENTITY_MISMATCHED",
  "UNABLE_TO_CREATE_SESSION",
]);

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

export function failureMessage(error: unknown): string {
  const detail = (error && typeof error === "object" ? error : {}) as Record<string, unknown>;
  const code = typeof detail.code === "string" ? detail.code : "";
  const status = typeof detail.status === "number" ? detail.status : 0;
  if (DISMISSED.test(code)) return SIGN_IN_OUTCOMES.dismissed;
  if (UNAVAILABLE.has(code) || status >= 500) return SIGN_IN_OUTCOMES.unavailable;
  return SIGN_IN_OUTCOMES.refused;
}

/** The request never got an answer, which is neither a passkey's fault nor a rejection. */
export function thrownFailureMessage(): string {
  return "This installation could not be reached. Check that it is running and try again.";
}
