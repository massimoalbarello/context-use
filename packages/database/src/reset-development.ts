import { Client } from "pg";

export const DEVELOPMENT_RESET_TABLES = [
  "confirmation_challenges",
  "publication_intents",
  "knowledge_export_intents",
  "page_deletion_intents",
  "knowledge_asset_links",
  "knowledge_page_changes",
  "knowledge_page_versions",
  "knowledge_pages",
  "assets",
  "knowledge_directories",
] as const;

export function developmentResetSql(): string {
  return `
    TRUNCATE TABLE ${DEVELOPMENT_RESET_TABLES.join(", ")} RESTART IDENTITY;
    INSERT INTO knowledge_directories(
      id,current_path,title,summary,search_vector
    ) VALUES (
      gen_random_uuid(),'',
      'Knowledge',
      'The root of the owner''s private, progressively discoverable knowledge base.',
      directory_search_vector(
        '',
        'Knowledge',
        'The root of the owner''s private, progressively discoverable knowledge base.',
        ''
      )
    );
  `;
}

async function resetDevelopmentData(): Promise<void> {
  if (process.env.CONTEXT_USE_DEVELOPMENT_RESET !== "preserve-auth") {
    throw new Error("Refusing to reset data without CONTEXT_USE_DEVELOPMENT_RESET=preserve-auth");
  }
  const migrationUrl = process.env.MIGRATOR_DATABASE_URL ?? process.env.DATABASE_ADMIN_URL;
  if (!migrationUrl) throw new Error("MIGRATOR_DATABASE_URL or DATABASE_ADMIN_URL is required");
  const target = new URL(migrationUrl);
  if (process.env.NODE_ENV === "production" || target.hostname !== "postgres" || target.username !== "postgres") {
    throw new Error("Development reset requires the local Compose PostgreSQL administrator");
  }

  const client = new Client({ connectionString: migrationUrl, application_name: "context-use-development-reset" });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(developmentResetSql());
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

if (import.meta.main) await resetDevelopmentData();
