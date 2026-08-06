export type PasskeyMutation = "register" | "update" | "delete";
export type PasskeyOwnerLock = "authentication" | "registration";
type PasskeyMutationRejection = { error: string; status: 409 };

export function passkeyMutationForPath(path: string): PasskeyMutation | null {
  if (path.endsWith("/passkey/generate-register-options") || path.endsWith("/passkey/verify-registration")) {
    return "register";
  }
  if (path.endsWith("/passkey/update-passkey")) return "update";
  if (path.endsWith("/passkey/delete-passkey")) return "delete";
  return null;
}

export function passkeyOwnerLockForPath(path: string): PasskeyOwnerLock | null {
  if (path.endsWith("/passkey/verify-authentication")) return "authentication";
  if (path.endsWith("/passkey/verify-registration")) return "registration";
  return null;
}

export async function whilePasskeyOwnerLockHeld<T>(
  operation: () => Promise<T>,
  release: (() => Promise<void>) | undefined,
): Promise<T> {
  try {
    return await operation();
  } finally {
    await release?.();
  }
}

export function immutablePasskeyRejection(
  mutation: PasskeyMutation,
  _passkeyCount: number,
): PasskeyMutationRejection | null {
  if (mutation !== "register") return { error: "passkey_immutable", status: 409 };
  return null;
}
