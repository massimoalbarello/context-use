import { Client } from "pg";
import { databaseNameFromUrl, markDisposableSql } from "./disposable-database.ts";

/**
 * Marks a database as one the integration suites may destroy. This is the whole
 * opt-in, so it refuses the one thing it must never be pointed at: a registered
 * owner passkey is what distinguishes an installation somebody signs in to from
 * a database provisioned to be thrown away.
 */
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");

const name = databaseNameFromUrl(url);
const client = new Client({ connectionString: url, application_name: "context-use-mark-disposable" });
await client.connect();
try {
  const live = await client.query<{ registered: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM passkey) AS registered WHERE to_regclass('public.passkey') IS NOT NULL",
  );
  if (live.rows[0]?.registered) {
    throw new Error(
      `Refusing to mark "${name}" disposable: an owner passkey is registered against it, so it is an ` +
      "installation somebody signs in to. The integration suites delete owner fixtures with trigger and " +
      "foreign-key enforcement suspended, which would destroy it.",
    );
  }
  await client.query(markDisposableSql(name));
  console.info(`Marked ${name} disposable`);
} finally {
  await client.end();
}
