import { createHash, randomBytes } from "node:crypto";
import { Pool } from "pg";
import { config } from "./config.ts";

const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
const pool = new Pool({ connectionString: config.AUTH_DATABASE_URL, application_name: "context-use-recovery" });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query("UPDATE \"oauthRefreshToken\" SET revoked=now() WHERE revoked IS NULL");
  await client.query("DELETE FROM \"oauthConsent\"");
  await client.query("DELETE FROM \"session\"");
  await client.query("DELETE FROM passkey_recovery_tokens WHERE consumed_at IS NULL");
  await client.query(
    "INSERT INTO passkey_recovery_tokens(token_hash,owner_email,expires_at) VALUES ($1,$2,now()+interval '10 minutes')",
    [tokenHash, config.OWNER_EMAIL.toLowerCase()],
  );
  await client.query(
    `INSERT INTO security_audit_events(event_type,actor_type,actor_id,details)
     VALUES ('passkey_recovery_started','deployment','aws-administrator',$1::jsonb)`,
    [JSON.stringify({ expires_in_seconds: 600 })],
  );
  await client.query("COMMIT");
  console.log(`${config.APP_ORIGIN}/app/recover-passkey?token=${token}`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
