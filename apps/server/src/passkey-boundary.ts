import { authPool, dashboardPrincipal } from "./auth.ts";
import { ownerUserId } from "./owner.ts";
import { enrollmentForContext } from "./passkey-management.ts";
import {
  immutablePasskeyRejection,
  ownerAuthenticationLockForPath,
  passkeyMutationForPath,
} from "./passkey-policy.ts";

type OwnerAuthenticationBoundary = {
  denied: Response | null;
  release?: () => Promise<void>;
};

export async function authorizeOwnerAuthenticationRequest(request: Request): Promise<OwnerAuthenticationBoundary> {
  const path = new URL(request.url).pathname;
  const mutation = passkeyMutationForPath(path);
  const lockMode = ownerAuthenticationLockForPath(path);
  const registrationVerification = mutation === "register" && lockMode === "passkey-registration";
  if (!mutation && !lockMode) return { denied: null };

  if (mutation && mutation !== "register") {
    const principal = await dashboardPrincipal(request);
    if (!principal) return { denied: Response.json({ error: "owner_session_required" }, { status: 401 }) };
    const rejection = immutablePasskeyRejection(mutation, 0);
    return { denied: Response.json({ error: rejection!.error }, { status: rejection!.status }) };
  }

  const lockClient = lockMode ? await authPool.connect() : null;
  let lockHeld = false;
  let clientReleased = false;
  const releaseLock = async () => {
    if (!lockClient || clientReleased) return;
    clientReleased = true;
    if (!lockHeld) {
      lockClient.release();
      return;
    }
    try {
      await lockClient.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [ownerUserId]);
      lockHeld = false;
      lockClient.release();
    } catch (error) {
      lockClient.release(error as Error);
      throw error;
    }
  };
  try {
    if (lockClient) {
      // Never queue a pool connection while another request holds the lock:
      // enough blocked login requests could otherwise exhaust the auth pool
      // and prevent the lock holder from completing its Better Auth writes.
      const lock = await lockClient.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
        [ownerUserId],
      );
      if (!lock.rows[0]?.locked) {
        await releaseLock();
        if (lockMode === "oauth-token") {
          return {
            denied: Response.json({
              error: "temporarily_unavailable",
              error_description: "Owner authentication is changing",
            }, {
              status: 503,
              headers: {
                "cache-control": "no-store",
                pragma: "no-cache",
                "retry-after": "1",
              },
            }),
          };
        }
        const error = lockMode === "passkey-authentication"
          ? "passkey_authentication_in_progress"
          : "passkey_registration_in_progress";
        return { denied: Response.json({ error }, { status: 409 }) };
      }
      lockHeld = true;
    }

    // Hold the owner lock until Better Auth has finished creating a passkey
    // session or issuing/rotating OAuth tokens. Passkey removal takes the same
    // lock before revoking tokens and sessions, so neither operation can leave
    // behind authentication created midway through revocation.
    if (!mutation) return { denied: null, release: releaseLock };

    const database = lockClient ?? authPool;
    const passkeyCount = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM passkey WHERE \"userId\"=$1",
      [ownerUserId],
    );
    const count = Number(passkeyCount.rows[0]?.count ?? 0);
    if (!registrationVerification && count > 0) {
      const requestUrl = new URL(request.url);
      const context = requestUrl.searchParams.get("context");
      const enrollment = await enrollmentForContext(database, context);
      if (!enrollment) {
        await releaseLock();
        return { denied: Response.json({ error: "confirmed_passkey_enrollment_required" }, { status: 403 }) };
      }
      const requestedName = requestUrl.searchParams.get("name");
      const requestedAttachment = requestUrl.searchParams.get("authenticatorAttachment");
      if ((requestedName !== null && requestedName.trim() !== enrollment.name)
          || requestedAttachment !== enrollment.authenticator_attachment) {
        await releaseLock();
        return { denied: Response.json({ error: "passkey_enrollment_mismatch" }, { status: 403 }) };
      }
    }
    const rejection = immutablePasskeyRejection("register", count);
    if (rejection) {
      await releaseLock();
      return { denied: Response.json({ error: rejection.error }, { status: rejection.status }) };
    }
    return lockClient
      ? {
          denied: null,
          release: releaseLock,
        }
      : { denied: null };
  } catch (error) {
    await releaseLock().catch(() => undefined);
    throw error;
  }
}
