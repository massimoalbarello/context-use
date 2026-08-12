import { assertDisposableDatabaseUrl } from "../packages/database/src/disposable-database.ts";

/**
 * Starts and migrates the disposable PostgreSQL the integration suites require,
 * so the alternative to pointing them at the local stack is one command. The
 * suites refuse any database that is not named for disposal; this is the one
 * that is.
 */
export const TEST_DATABASE = {
  url: "postgres://postgres:postgres@127.0.0.1:55432/context_use_test",
  compose: "compose.test.yml",
} as const;

// The suites reach PostgreSQL as its administrator. The role passwords only
// matter to the suites that connect as an application role, and this server
// holds nothing worth protecting.
const ROLE_PASSWORDS = {
  DB_AUTH_PASSWORD: "test-only",
  DB_DASHBOARD_PASSWORD: "test-only",
  DB_MCP_PASSWORD: "test-only",
  DB_PUBLIC_PASSWORD: "test-only",
  DB_CONFIRMATION_PASSWORD: "test-only",
  DB_STORAGE_PASSWORD: "test-only",
  DB_BACKUP_PASSWORD: "test-only",
} as const;

const repository = `${import.meta.dir}/..`;

function run(command: string[], environment: Record<string, string> = {}): void {
  const child = Bun.spawnSync(command, {
    cwd: repository,
    env: { ...process.env, ...environment },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (child.exitCode !== 0) process.exit(child.exitCode ?? 1);
}

function compose(...arguments_: string[]): void {
  run(["docker", "compose", "--file", TEST_DATABASE.compose, ...arguments_]);
}

const command = process.argv[2] ?? "up";
if (command === "down") {
  compose("down", "--remove-orphans");
} else if (command === "up") {
  assertDisposableDatabaseUrl(TEST_DATABASE.url);
  compose("up", "--detach", "--wait");
  run(["bun", "--cwd", "packages/database", "migrate"], {
    ...ROLE_PASSWORDS,
    MIGRATOR_DATABASE_URL: TEST_DATABASE.url,
  });
  console.info(`\nRun the integration suites against it:\n  TEST_DATABASE_URL=${TEST_DATABASE.url} bun test apps packages`);
} else {
  console.error("Usage: bun run db:test <up|down>");
  process.exit(1);
}
