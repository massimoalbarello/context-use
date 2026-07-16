import { authPool, dashboardPrincipal } from "./auth.ts";
import { immutablePasskeyRejection, passkeyMutationForPath } from "./passkey-policy.ts";

type PasskeyAuthBoundary = {
  denied: Response | null;
  release?: () => Promise<void>;
};

export async function authorizePasskeyAuthRequest(request: Request): Promise<PasskeyAuthBoundary> {
  const path = new URL(request.url).pathname;
  const mutation = passkeyMutationForPath(path);
  if (!mutation) return { denied: null };

  const principal = await dashboardPrincipal(request);
  if (!principal) return { denied: Response.json({ error: "owner_session_required" }, { status: 401 }) };

  if (mutation !== "register") {
    const rejection = immutablePasskeyRejection(mutation, 0, undefined);
    return { denied: Response.json({ error: rejection!.error }, { status: rejection!.status }) };
  }

  const verification = path.endsWith("/passkey/verify-registration");
  const lockClient = verification ? await authPool.connect() : null;
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
      await lockClient.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [principal.userId]);
      lockHeld = false;
      lockClient.release();
    } catch (error) {
      lockClient.release(error as Error);
      throw error;
    }
  };
  try {
    if (lockClient) {
      const lock = await lockClient.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
        [principal.userId],
      );
      if (!lock.rows[0]?.locked) {
        await releaseLock();
        return { denied: Response.json({ error: "passkey_registration_in_progress" }, { status: 409 }) };
      }
      lockHeld = true;
    }

    const database = lockClient ?? authPool;
    const passkeyCount = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM passkey WHERE \"userId\"=$1",
      [principal.userId],
    );
    const count = Number(passkeyCount.rows[0]?.count ?? 0);
    let sessionCreatedAt: Date | undefined;
    if (count === 0) {
      const session = await database.query<{ createdAt: Date }>(
        "SELECT \"createdAt\" FROM session WHERE id=$1",
        [principal.sessionId],
      );
      const createdAt = session.rows[0]?.createdAt;
      sessionCreatedAt = createdAt ? new Date(createdAt) : undefined;
    }

    const rejection = immutablePasskeyRejection("register", count, sessionCreatedAt);
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
