import { Client } from "pg";

/**
 * Integration suites commit their fixtures and then clean them up, in places
 * with trigger and foreign-key enforcement suspended, so the database they are
 * pointed at must be one nobody minds losing. A run against the local Compose
 * stack once deleted the owner identity the evals sign in with while leaving
 * its passkey and session behind, which broke sign-in with a foreign-key
 * violation rather than anything the UI could explain.
 *
 * A database opts in by carrying this setting, which survives reconnects and
 * migrations but is not carried by `pg_dump`, so a restore cannot smuggle it
 * into an installation. Silently skipping an unmarked database would hide the
 * mistake, so it fails loudly instead: the only quiet outcome is an unset
 * TEST_DATABASE_URL.
 */
export const DISPOSABLE_SETTING = "context_use.disposable_test_database";

export function databaseNameFromUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`TEST_DATABASE_URL is not a valid connection URL: ${url}`);
  }
  return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
}

/** Run by whoever provisions a throwaway database, and by nothing else. */
export function markDisposableSql(databaseName: string): string {
  return `ALTER DATABASE "${databaseName.replaceAll('"', '""')}" SET "${DISPOSABLE_SETTING}" = 'true'`;
}

export function notDisposableMessage(databaseName: string): string {
  return `TEST_DATABASE_URL points at the ${databaseName ? `"${databaseName}"` : "default"} database, ` +
    "which is not marked disposable. Integration suites create and delete owner fixtures with trigger and " +
    "foreign-key enforcement suspended, so running them against a live installation — such as the local " +
    "Compose stack the evals sign in to — destroys real data. `bun run db:test up` starts and marks a " +
    `throwaway server; to mark an existing one, run: ${markDisposableSql(databaseName || "your_database")}`;
}

export async function assertDisposableDatabase(url: string): Promise<string> {
  const client = new Client({ connectionString: url, application_name: "context-use-disposable-check" });
  await client.connect();
  try {
    const marked = await client.query<{ value: string | null }>("SELECT current_setting($1,true) AS value", [
      DISPOSABLE_SETTING,
    ]);
    if (marked.rows[0]?.value !== "true") throw new Error(notDisposableMessage(databaseNameFromUrl(url)));
  } finally {
    await client.end();
  }
  return url;
}

/**
 * The connection every integration suite gates on: undefined when no database
 * was configured, and a throw when the configured one has not opted in.
 */
export async function disposableDatabaseUrl(): Promise<string | undefined> {
  const url = process.env.TEST_DATABASE_URL;
  return url ? await assertDisposableDatabase(url) : undefined;
}
