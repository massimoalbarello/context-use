/**
 * Integration suites commit their fixtures and then clean them up, in places
 * with trigger and foreign-key enforcement suspended, so the database they are
 * pointed at must be one nobody minds losing. A run against the local Compose
 * stack once deleted the owner identity the evals sign in with while leaving
 * its passkey and session behind, which broke sign-in with a foreign-key
 * violation rather than anything the UI could explain.
 *
 * A database opts in to that treatment by name. Silently skipping an
 * unsuitable target would hide the mistake, so an unsuitable one fails loudly
 * instead: the only quiet outcome is an unset TEST_DATABASE_URL.
 */
export const DISPOSABLE_DATABASE_SUFFIX = "_test";

export function databaseNameFromUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`TEST_DATABASE_URL is not a valid connection URL: ${url}`);
  }
  return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
}

export function assertDisposableDatabaseUrl(url: string): string {
  const name = databaseNameFromUrl(url);
  if (name.endsWith(DISPOSABLE_DATABASE_SUFFIX)) return url;
  throw new Error(
    `TEST_DATABASE_URL points at the ${name ? `"${name}"` : "default"} database, which is not disposable. ` +
    "Integration suites create and delete owner fixtures with trigger and foreign-key enforcement suspended, " +
    "so running them against a live installation — such as the local Compose stack the evals sign in to — " +
    `destroys real data. Point TEST_DATABASE_URL at a database whose name ends in "${DISPOSABLE_DATABASE_SUFFIX}" ` +
    "on a PostgreSQL server of its own; `bun run db:test up` starts and migrates one.",
  );
}

/**
 * The connection every integration suite gates on: undefined when no database
 * was configured, and a throw when the configured one is not disposable.
 */
export function disposableDatabaseUrl(): string | undefined {
  const url = process.env.TEST_DATABASE_URL;
  return url ? assertDisposableDatabaseUrl(url) : undefined;
}
