import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

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
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
  const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
  const applied = await client.query<{ version: string }>("SELECT version FROM schema_migrations ORDER BY version");
  const baseline = "001_baseline.sql";
  const existingRelations = await client.query<{ relation: string }>(
    `SELECT relname AS relation
     FROM pg_class
     WHERE relnamespace='public'::regnamespace
       AND relkind IN ('r','p','v','m','S')
       AND relname<>'schema_migrations'
     ORDER BY relname`,
  );
  if (
    files.includes(baseline)
    && !applied.rows.some(({ version }) => version === baseline)
    && (applied.rowCount || existingRelations.rowCount)
  ) {
    const reason = applied.rowCount
      ? `legacy migrations: ${applied.rows.map(({ version }) => version).join(", ")}`
      : `existing relations: ${existingRelations.rows.map(({ relation }) => relation).join(", ")}`;
    throw new Error(
      `${baseline} can only be applied to a fresh database; found ${reason}`,
    );
  }
  for (const file of files) {
    const existing = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [file]);
    if (existing.rowCount) continue;
    const sql = await readFile(join(migrationsDirectory, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.info(`Applied ${file}`);
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
