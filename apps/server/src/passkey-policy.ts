const FRESH_SESSION_WINDOW_MS = 600_000;

type PasskeyMutation = "register" | "delete";
type PasskeyMutationRejection = { error: string; status: 403 | 409 };

export function immutablePasskeyRejection(
  mutation: PasskeyMutation,
  passkeyCount: number,
  sessionCreatedAt: Date | undefined,
  now = Date.now(),
): PasskeyMutationRejection | null {
  if (mutation === "delete") return { error: "passkey_immutable", status: 409 };
  if (passkeyCount > 0) return { error: "passkey_already_registered", status: 409 };
  if (!sessionCreatedAt || now - sessionCreatedAt.getTime() > FRESH_SESSION_WINDOW_MS) {
    return { error: "fresh_session_required", status: 403 };
  }
  return null;
}
