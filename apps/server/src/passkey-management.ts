import { createHash } from "node:crypto";
import { authPool, dashboardPrincipal } from "./auth.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function authorizePasskeyAuthRequest(request: Request): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const registration = path.endsWith("/passkey/generate-register-options") || path.endsWith("/passkey/verify-registration");
  const deletion = path.endsWith("/passkey/delete-passkey");
  if (!registration && !deletion) return null;
  const principal = await dashboardPrincipal(request);
  if (!principal) return Response.json({ error: "owner_session_required" }, { status: 401 });

  const passkeyCount = await authPool.query<{ count: string }>("SELECT count(*)::text AS count FROM passkey WHERE \"userId\"=$1", [principal.userId]);
  if (registration && Number(passkeyCount.rows[0]?.count ?? 0) === 0) {
    const session = await authPool.query<{ createdAt: Date }>("SELECT \"createdAt\" FROM session WHERE id=$1", [principal.sessionId]);
    if (session.rows[0] && Date.now() - new Date(session.rows[0].createdAt).getTime() <= 600_000) return null;
    return Response.json({ error: "fresh_session_required" }, { status: 403 });
  }
  if (deletion && Number(passkeyCount.rows[0]?.count ?? 0) <= 1) {
    return Response.json({ error: "last_passkey_cannot_be_deleted" }, { status: 409 });
  }

  const token = request.headers.get("x-passkey-management-token");
  if (!token) return Response.json({ error: "passkey_management_confirmation_required" }, { status: 403 });
  let target: string | null = null;
  if (deletion) {
    const body = await request.clone().json().catch(() => ({})) as { id?: string };
    target = body.id ?? null;
  }
  const action = deletion ? "delete_passkey" : "add_passkey";
  const consumesGrant = path.endsWith("/verify-registration") || deletion;
  const grant = await authPool.query<{ id: string }>(
    consumesGrant
      ? `UPDATE passkey_management_grants SET consumed_at=now()
         WHERE token_hash=$1 AND action=$2 AND owner_user_id=$3 AND session_id=$4
           AND consumed_at IS NULL AND expires_at>now()
           AND ($5::text IS NULL OR target_credential_id=$5)
         RETURNING id`
      : `SELECT id FROM passkey_management_grants
         WHERE token_hash=$1 AND action=$2 AND owner_user_id=$3 AND session_id=$4
           AND consumed_at IS NULL AND expires_at>now()
           AND ($5::text IS NULL OR target_credential_id=$5)`,
    [hash(token), action, principal.userId, principal.sessionId, target],
  );
  if (!grant.rowCount) return Response.json({ error: "passkey_management_grant_invalid" }, { status: 403 });
  return null;
}
