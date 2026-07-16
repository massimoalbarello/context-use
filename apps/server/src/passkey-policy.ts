export type PasskeyMutation = "register" | "update" | "delete";
type PasskeyMutationRejection = { error: string; status: 409 };

export function passkeyMutationForPath(path: string): PasskeyMutation | null {
  if (path.endsWith("/passkey/generate-register-options") || path.endsWith("/passkey/verify-registration")) {
    return "register";
  }
  if (path.endsWith("/passkey/update-passkey")) return "update";
  if (path.endsWith("/passkey/delete-passkey")) return "delete";
  return null;
}

export function immutablePasskeyRejection(
  mutation: PasskeyMutation,
  passkeyCount: number,
): PasskeyMutationRejection | null {
  if (mutation !== "register") return { error: "passkey_immutable", status: 409 };
  if (passkeyCount > 0) return { error: "passkey_already_registered", status: 409 };
  return null;
}
