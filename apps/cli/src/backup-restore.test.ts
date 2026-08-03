import { expect, test } from "bun:test";
import { databaseBackupCommands, releaseIncludesNango } from "./commands/backup.ts";
import { nangoRestoreCommands } from "./commands/nango/restore.ts";

test("manual backup creates both database backups and requires Nango support", () => {
  const script = databaseBackupCommands(true).join("\n");
  const contextBackup = "run --rm backup once";
  const nangoBackup = "run --rm nango-backup once";

  expect(script).toContain("config --services | grep -Fx nango-backup >/dev/null");
  expect(script.indexOf(contextBackup)).toBeLessThan(script.indexOf(nangoBackup));
  expect(script).toContain("This deployment does not define the nango-backup service");
  expect(script).toContain("exit 1");
});

test("pre-update backup skips Nango only when upgrading an older deployment", () => {
  const script = databaseBackupCommands(false).join("\n");

  expect(script).toContain("run --rm backup once");
  expect(script).toContain("run --rm nango-backup once");
  expect(script).toContain("--no-deps --entrypoint psql nango-backup -X -tAc 'SELECT 1' | grep -qx 1");
  expect(script).toContain("Older or partially upgraded deployment has no initialized Nango database; skipping it");
  expect(script).toContain("Older deployment has no nango-backup service; skipping it");
  expect(script).not.toContain("exit 1");
});

test("pre-update backup becomes mandatory after the first Nango release", () => {
  expect(releaseIncludesNango("v0.1.46")).toBe(false);
  expect(releaseIncludesNango("v0.1.47")).toBe(true);
  expect(releaseIncludesNango("v0.1.48")).toBe(true);
  expect(releaseIncludesNango("v0.2.0")).toBe(true);
  expect(releaseIncludesNango("v1.0.0")).toBe(true);
  expect(() => releaseIncludesNango("latest")).toThrow("Invalid installed release version");
});

test("Nango restore backs up first, isolates Nango, recreates its database, and restores as its owner", () => {
  const script = nangoRestoreCommands(
    "cu-123456789012-eu-west-2-abcdef123456-backups",
    "nango-postgres/2026-07-30T12-34-56-123456789Z.sql.gz",
  ).join("\n");

  const freshBackup = "run --rm nango-backup once";
  const stop = "stop nango-jobs nango-server nango-orchestrator nango-persist nango-redis nango-backup";
  const drop = "DROP DATABASE IF EXISTS nango WITH (FORCE)";
  const recreate = "--profile nango-init run --rm nango-db-init";
  const fetch = "run --rm --no-deps -T -e BACKUP_BUCKET='cu-123456789012-eu-west-2-abcdef123456-backups' nango-backup fetch 'nango-postgres/2026-07-30T12-34-56-123456789Z.sql.gz'";

  expect(script.indexOf(freshBackup)).toBeLessThan(script.indexOf(stop));
  expect(script.indexOf(stop)).toBeLessThan(script.indexOf(drop));
  expect(script.indexOf(drop)).toBeLessThan(script.indexOf(recreate));
  expect(script.indexOf(recreate)).toBeLessThan(script.indexOf(fetch));
  expect(script).toContain("trap restore_failed EXIT");
  expect(script).toContain("Nango services remain stopped");
  expect(script).toContain("rm -f nango-redis");
  expect(script).toContain("nango-integrations-quarantine");
  expect(script).toContain("find /data/context-use/nango-integrations -mindepth 1 -maxdepth 1");
  expect(script).toContain(fetch);
  expect(script).toContain("-U nango_app -d nango --single-transaction");
  expect(script.match(/--profile nango-init run --rm nango-db-init/g)?.length).toBe(3);
  const startServer = "up -d --wait nango-redis nango-server";
  const startWorkers = "up -d --wait nango-orchestrator nango-persist nango-jobs";
  expect(script).toContain(startServer);
  expect(script).toContain(startWorkers);
  expect(script.indexOf(startServer)).toBeLessThan(script.indexOf(startWorkers));
  expect(script).toContain("up -d nango-backup");
  expect(script).not.toContain("stop caddy");
  expect(script).not.toContain("stop app");
  expect(script).not.toContain("--profile migration");
});

test("Nango restore accepts only its own verified backup namespace", () => {
  expect(() => nangoRestoreCommands("backups", "postgres/2026-07-30T12-34-56Z.sql.gz"))
    .toThrow("Invalid Nango backup key");
  expect(() => nangoRestoreCommands("backups'; false", "nango-postgres/2026-07-30T12-34-56Z.sql.gz"))
    .toThrow("Invalid backup bucket");
});
