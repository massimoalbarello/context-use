import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { config } from "./config.ts";
import { SecurityError } from "./security.ts";

export const passkeyLabelSchema = z.string().trim().min(1).max(80);
export const authenticatorAttachmentSchema = z.enum(["cross-platform"]).nullable().default(null);
export const passkeyIdSchema = z.string().min(1).max(512);
export const managementIntentIdSchema = z.string().uuid();
export const passkeyAssertionSchema = z.custom<AuthenticationResponseJSON>(
  (value) => Boolean(value && typeof value === "object"),
);

type Queryable = Pool | PoolClient;
type Principal = { userId: string; sessionId: string };
type PasskeyRow = {
  id: string;
  name: string | null;
  publicKey: string;
  credentialID: string;
  counter: number;
  transports: string | null;
};
type ManagementIntent = {
  id: string;
  action: "enroll" | "delete";
  owner_user_id: string;
  session_id: string;
  target_passkey_id: string | null;
  name: string | null;
  authenticator_attachment: "cross-platform" | null;
  challenge: string;
  token_hash: string | null;
  expires_at: Date;
  confirmed_at: Date | null;
  consumed_at: Date | null;
};

const ownerUserId = "context-use-owner";
const intentLifetimeMilliseconds = 5 * 60 * 1_000;

function transports(value: string | null): AuthenticatorTransportFuture[] | undefined {
  const parsed = value?.split(",").filter(Boolean) as AuthenticatorTransportFuture[] | undefined;
  return parsed?.length ? parsed : undefined;
}

async function ownerPasskeys(database: Queryable): Promise<PasskeyRow[]> {
  const result = await database.query<PasskeyRow>(
    `SELECT id,name,"publicKey","credentialID",counter,transports
     FROM passkey WHERE "userId"=$1 ORDER BY "createdAt",id`,
    [ownerUserId],
  );
  return result.rows;
}

async function authenticationOptions(database: Queryable) {
  const passkeys = await ownerPasskeys(database);
  if (!passkeys.length) throw new SecurityError("Register the initial passkey first", 409);
  return generateAuthenticationOptions({
    rpID: config.WEBAUTHN_RP_ID,
    userVerification: "required",
    timeout: intentLifetimeMilliseconds,
    allowCredentials: passkeys.map((key) => {
      const keyTransports = transports(key.transports);
      return { id: key.credentialID, ...(keyTransports ? { transports: keyTransports } : {}) };
    }),
  });
}

async function cleanupIntents(database: Queryable): Promise<void> {
  await database.query("DELETE FROM passkey_management_intents WHERE expires_at<=now()");
}

export async function beginPasskeyRemovalTransaction(client: PoolClient): Promise<void> {
  await client.query("BEGIN");
  // This must be the first lock in the transaction. Passkey authentication
  // takes the same owner lock before Better Auth reads a credential or creates
  // a session, preventing either side from acquiring row locks out of order.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [ownerUserId]);
}

export async function revokeOwnerAuthentication(database: Queryable, userId: string): Promise<void> {
  // These foreign keys intentionally use ON DELETE SET NULL for general OAuth
  // compatibility. Revoke OAuth credentials first so deleting a bound session
  // can never turn its token into an unbound, still-active credential.
  await database.query(
    `UPDATE "oauthRefreshToken"
     SET revoked=coalesce(revoked,now()),
         "rotationReplayResponse"=NULL,
         "rotationReplayExpiresAt"=NULL
     WHERE "userId"=$1`,
    [userId],
  );
  await database.query(
    `UPDATE "oauthAccessToken"
     SET revoked=coalesce(revoked,now())
     WHERE "userId"=$1`,
    [userId],
  );
  await database.query(`DELETE FROM "session" WHERE "userId"=$1`, [userId]);
}

export async function createEnrollmentIntent(
  database: Queryable,
  principal: Principal,
  name: string,
  authenticatorAttachment: "cross-platform" | null,
) {
  await cleanupIntents(database);
  const options = await authenticationOptions(database);
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + intentLifetimeMilliseconds);
  await database.query(
    `INSERT INTO passkey_management_intents(
       id,action,owner_user_id,session_id,name,authenticator_attachment,
       challenge,expires_at
     ) VALUES ($1,'enroll',$2,$3,$4,$5,$6,$7)`,
    [id, principal.userId, principal.sessionId, name, authenticatorAttachment, options.challenge, expiresAt],
  );
  return {
    intent: { id, name, authenticator_attachment: authenticatorAttachment, expires_at: expiresAt },
    authentication_options: options,
  };
}

export async function createRemovalIntent(
  database: Queryable,
  principal: Principal,
  targetPasskeyId: string,
) {
  await cleanupIntents(database);
  const target = await database.query<{ id: string; name: string | null; total: string }>(
    `SELECT key.id,key.name,count(*) OVER ()::text AS total
     FROM passkey key
     WHERE key."userId"=$1
     ORDER BY key."createdAt",key.id`,
    [principal.userId],
  );
  const selected = target.rows.find((key) => key.id === targetPasskeyId);
  if (!selected) throw new SecurityError("Passkey not found", 404);
  if (Number(selected.total) <= 1) throw new SecurityError("At least one passkey must remain", 409);

  const options = await authenticationOptions(database);
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + intentLifetimeMilliseconds);
  await database.query(
    `INSERT INTO passkey_management_intents(
       id,action,owner_user_id,session_id,target_passkey_id,challenge,expires_at
     ) VALUES ($1,'delete',$2,$3,$4,$5,$6)`,
    [id, principal.userId, principal.sessionId, targetPasskeyId, options.challenge, expiresAt],
  );
  return {
    intent: {
      id,
      passkey_id: selected.id,
      passkey_name: selected.name,
      expires_at: expiresAt,
    },
    authentication_options: options,
  };
}

async function lockedIntent(
  client: PoolClient,
  intentId: string,
  principal: Principal,
  action: ManagementIntent["action"],
): Promise<ManagementIntent> {
  const result = await client.query<ManagementIntent>(
    `SELECT id,action,owner_user_id,session_id,target_passkey_id,name,
            authenticator_attachment,challenge,token_hash,expires_at,
            confirmed_at,consumed_at
     FROM passkey_management_intents
     WHERE id=$1
     FOR UPDATE`,
    [intentId],
  );
  const intent = result.rows[0];
  if (!intent || intent.action !== action
      || intent.owner_user_id !== principal.userId
      || intent.session_id !== principal.sessionId) {
    throw new SecurityError("Passkey management request not found", 404);
  }
  if (intent.confirmed_at || intent.consumed_at || intent.expires_at.getTime() <= Date.now()) {
    throw new SecurityError("Passkey management request is inactive", 409);
  }
  return intent;
}

async function verifyAssertion(
  client: PoolClient,
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
): Promise<{ key: PasskeyRow; newCounter: number }> {
  const result = await client.query<PasskeyRow>(
    `SELECT id,name,"publicKey","credentialID",counter,transports
     FROM passkey
     WHERE "userId"=$1 AND "credentialID"=$2
     FOR UPDATE`,
    [ownerUserId, response.id],
  );
  const key = result.rows[0];
  if (!key) throw new SecurityError("Passkey verification failed", 403);
  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: config.APP_ORIGIN,
      expectedRPID: config.WEBAUTHN_RP_ID,
      credential: {
        id: key.credentialID,
        publicKey: Buffer.from(key.publicKey, "base64"),
        counter: key.counter,
        ...(() => {
          const keyTransports = transports(key.transports);
          return keyTransports ? { transports: keyTransports } : {};
        })(),
      },
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.authenticationInfo.userVerified) {
      throw new SecurityError("Passkey verification failed", 403);
    }
    return { key, newCounter: verification.authenticationInfo.newCounter };
  } catch (error) {
    if (error instanceof SecurityError) throw error;
    throw new SecurityError("Passkey verification failed", 403);
  }
}

export async function confirmEnrollmentIntent(
  pool: Pool,
  principal: Principal,
  intentId: string,
  response: AuthenticationResponseJSON,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const intent = await lockedIntent(client, intentId, principal, "enroll");
    const verified = await verifyAssertion(client, response, intent.challenge);
    await client.query("UPDATE passkey SET counter=$1 WHERE id=$2", [verified.newCounter, verified.key.id]);
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await client.query(
      `UPDATE passkey_management_intents
       SET confirmed_at=now(),token_hash=$2,authorizing_credential_id=$3
       WHERE id=$1`,
      [intent.id, tokenHash, verified.key.credentialID],
    );
    await client.query("COMMIT");
    const claim = `${intent.id}.${token}`;
    return {
      enrollment_claim: claim,
      setup_url: `${config.APP_ORIGIN}/app#enroll=${encodeURIComponent(claim)}`,
      expires_at: intent.expires_at,
      name: intent.name,
      authenticator_attachment: intent.authenticator_attachment,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function confirmRemovalIntent(
  pool: Pool,
  principal: Principal,
  intentId: string,
  targetPasskeyId: string,
  response: AuthenticationResponseJSON,
): Promise<void> {
  const client = await pool.connect();
  try {
    await beginPasskeyRemovalTransaction(client);
    const intent = await lockedIntent(client, intentId, principal, "delete");
    if (intent.target_passkey_id !== targetPasskeyId) {
      throw new SecurityError("Passkey management request not found", 404);
    }
    const verified = await verifyAssertion(client, response, intent.challenge);
    await client.query("UPDATE passkey SET counter=$1 WHERE id=$2", [verified.newCounter, verified.key.id]);
    await client.query(
      `UPDATE passkey_management_intents
       SET confirmed_at=now(),consumed_at=now(),authorizing_credential_id=$2
       WHERE id=$1`,
      [intent.id, verified.key.credentialID],
    );
    await client.query("SELECT remove_owner_passkey($1,$2)", [principal.userId, targetPasskeyId]);
    await revokeOwnerAuthentication(client, principal.userId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

type EnrollmentClaim = { id: string; token: string };

export function parseEnrollmentContext(context: string | null | undefined): EnrollmentClaim | null {
  if (!context || context.length > 1_024) return null;
  let value: unknown;
  try {
    value = JSON.parse(context);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "enrollment_claim")
      || typeof record.enrollment_claim !== "string") return null;
  const match = record.enrollment_claim.match(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i,
  );
  return match ? { id: match[1]!, token: match[2]! } : null;
}

export async function enrollmentForContext(
  database: Queryable,
  context: string | null | undefined,
) {
  const claim = parseEnrollmentContext(context);
  if (!claim) return null;
  const tokenHash = createHash("sha256").update(claim.token).digest("hex");
  const result = await database.query<{
    id: string;
    name: string;
    authenticator_attachment: "cross-platform" | null;
  }>(
    `SELECT id,name,authenticator_attachment
     FROM passkey_management_intents
     WHERE id=$1 AND action='enroll' AND token_hash=$2
       AND confirmed_at IS NOT NULL AND consumed_at IS NULL AND expires_at>now()`,
    [claim.id, tokenHash],
  );
  return result.rows[0] ?? null;
}

export async function consumeEnrollmentContext(
  database: Queryable,
  context: string | null | undefined,
) {
  const claim = parseEnrollmentContext(context);
  if (!claim) return null;
  const tokenHash = createHash("sha256").update(claim.token).digest("hex");
  const result = await database.query<{ id: string; name: string }>(
    `UPDATE passkey_management_intents
     SET consumed_at=now()
     WHERE id=$1 AND action='enroll' AND token_hash=$2
       AND confirmed_at IS NOT NULL AND consumed_at IS NULL AND expires_at>now()
     RETURNING id,name`,
    [claim.id, tokenHash],
  );
  return result.rows[0] ?? null;
}
