/**
 * Starts, migrates, and marks the disposable PostgreSQL the integration suites
 * require, so the alternative to pointing them at a live installation is one
 * command. `mark` alone is for a database provisioned some other way, such as
 * the throwaway server CI runs against.
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

function mark(url: string): void {
  run(["bun", "--cwd", "packages/database", "mark:disposable"], { TEST_DATABASE_URL: url });
}

const command = process.argv[2] ?? "up";
if (command === "down") {
  compose("down", "--remove-orphans");
} else if (command === "mark") {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required");
  mark(url);
} else if (command === "up") {
  compose("up", "--detach", "--wait");
  run(["bun", "--cwd", "packages/database", "migrate"], {
    ...ROLE_PASSWORDS,
    MIGRATOR_DATABASE_URL: TEST_DATABASE.url,
  });
  mark(TEST_DATABASE.url);
  console.info(`\nRun the integration suites against it:\n  TEST_DATABASE_URL=${TEST_DATABASE.url} bun test apps packages`);
} else {
  console.error("Usage: bun run db:test <up|mark|down>");
  process.exit(1);
}
