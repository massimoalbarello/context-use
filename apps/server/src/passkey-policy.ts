export type PasskeyMutation = "register" | "update" | "delete";
export type OwnerAuthenticationLock =
  | "passkey-authentication"
  | "passkey-registration"
  | "oauth-token";
type PasskeyMutationRejection = { error: string; status: 409 };

export function passkeyMutationForPath(path: string): PasskeyMutation | null {
  if (path.endsWith("/passkey/generate-register-options") || path.endsWith("/passkey/verify-registration")) {
    return "register";
  }
  if (path.endsWith("/passkey/update-passkey")) return "update";
  if (path.endsWith("/passkey/delete-passkey")) return "delete";
  return null;
}

export function ownerAuthenticationLockForPath(path: string): OwnerAuthenticationLock | null {
  if (path.endsWith("/passkey/verify-authentication")) return "passkey-authentication";
  if (path.endsWith("/passkey/verify-registration")) return "passkey-registration";
  if (path.endsWith("/oauth2/token")) return "oauth-token";
  return null;
}

export async function whileOwnerAuthenticationLockHeld<T>(
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
