import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { assertMigrationState } from "./migration-state.ts";

const migrationUrl = process.env.MIGRATOR_DATABASE_URL ?? process.env.DATABASE_ADMIN_URL;
if (!migrationUrl) {
  throw new Error("MIGRATOR_DATABASE_URL or DATABASE_ADMIN_URL is required");
}

const client = new Client({ connectionString: migrationUrl });
await client.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text");

  const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
  const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
  const migrations = await Promise.all(files.map(async (version) => {
    const sql = await readFile(join(migrationsDirectory, version), "utf8");
    return {
      version,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
    };
  }));
  const applied = await client.query<{ version: string; checksum: string | null }>(
    "SELECT version,checksum FROM schema_migrations ORDER BY version",
  );
  const baseline = "001_baseline.sql";
  const existingRelations = await client.query<{ relation: string }>(
    `SELECT relname AS relation
     FROM pg_class
     WHERE relnamespace='public'::regnamespace
       AND relkind IN ('r','p','v','m','S')
       AND relname<>'schema_migrations'
     ORDER BY relname`,
  );
  assertMigrationState(
    migrations,
    applied.rows,
    existingRelations.rows.map(({ relation }) => relation),
    baseline,
  );
  await client.query("ALTER TABLE schema_migrations ALTER COLUMN checksum SET NOT NULL");
  for (const migration of migrations) {
    const existing = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [migration.version]);
    if (existing.rowCount) continue;
    await client.query("BEGIN");
    try {
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO schema_migrations(version,checksum) VALUES ($1,$2)",
        [migration.version, migration.checksum],
      );
      await client.query("COMMIT");
      console.info(`Applied ${migration.version}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  const passwordVariables: Record<string, string | undefined> = {
    context_use_auth: process.env.DB_AUTH_PASSWORD,
    context_use_dashboard: process.env.DB_DASHBOARD_PASSWORD,
    context_use_mcp: process.env.DB_MCP_PASSWORD,
    context_use_public: process.env.DB_PUBLIC_PASSWORD,
    context_use_confirmation: process.env.DB_CONFIRMATION_PASSWORD,
    context_use_storage: process.env.DB_STORAGE_PASSWORD,
    context_use_backup: process.env.DB_BACKUP_PASSWORD,
  };
  for (const [role, password] of Object.entries(passwordVariables)) {
    if (!password) continue;
    const literal = password.replaceAll("'", "''");
    await client.query(`ALTER ROLE ${role} LOGIN PASSWORD '${literal}'`);
  }
} finally {
  await client.end();
}
