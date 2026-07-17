import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

const adminUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = adminUrl ? describe : describe.skip;

describeDatabase("PostgreSQL security roles", () => {
  let admin: Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
  });

  afterAll(async () => {
    await admin.end();
  });

  async function expectDenied(sql: string, values: unknown[] = []): Promise<void> {
    await admin.query("SAVEPOINT expected_denial");
    let denied = false;
    try {
      await admin.query(sql, values);
    } catch {
      denied = true;
      await admin.query("ROLLBACK TO SAVEPOINT expected_denial");
    }
    await admin.query("RELEASE SAVEPOINT expected_denial");
    expect(denied).toBe(true);
  }

  test("MCP and dashboard roles cannot update publication columns", async () => {
    for (const role of ["context_use_mcp", "context_use_dashboard"]) {
      const privilege = await admin.query<{ allowed: boolean }>(
        "SELECT has_column_privilege($1, 'knowledge_pages', 'published_version_id', 'UPDATE') AS allowed",
        [role],
      );
      expect(privilege.rows[0]?.allowed).toBe(false);
      const slug = await admin.query<{ allowed: boolean }>(
        "SELECT has_column_privilege($1, 'knowledge_pages', 'public_slug', 'UPDATE') AS allowed",
        [role],
      );
      expect(slug.rows[0]?.allowed).toBe(false);
    }
  });

  test("only publisher role can execute visibility procedure", async () => {
    for (const role of ["context_use_mcp", "context_use_dashboard", "context_use_public", "context_use_auth"]) {
      const result = await admin.query<{ allowed: boolean }>(
        "SELECT has_function_privilege($1, 'confirm_publication_intent(uuid,text,text,text)', 'EXECUTE') AS allowed",
        [role],
      );
      expect(result.rows[0]?.allowed).toBe(false);
    }
    const publisher = await admin.query<{ allowed: boolean }>(
      "SELECT has_function_privilege('context_use_publisher', 'confirm_publication_intent(uuid,text,text,text)', 'EXECUTE') AS allowed",
    );
    expect(publisher.rows[0]?.allowed).toBe(true);
  });

  test("public role can see views but not private base tables", async () => {
    const privateTable = await admin.query<{ allowed: boolean }>(
      "SELECT has_table_privilege('context_use_public', 'knowledge_pages', 'SELECT') AS allowed",
    );
    const publicView = await admin.query<{ allowed: boolean }>(
      "SELECT has_table_privilege('context_use_public', 'published_pages', 'SELECT') AS allowed",
    );
    expect(privateTable.rows[0]?.allowed).toBe(false);
    expect(publicView.rows[0]?.allowed).toBe(true);
  });

  test("MCP cannot mutate assets", async () => {
    for (const privilege of ["INSERT", "UPDATE", "DELETE"]) {
      const result = await admin.query<{ allowed: boolean }>(
        "SELECT has_table_privilege('context_use_mcp', 'assets', $1) AS allowed",
        [privilege],
      );
      expect(result.rows[0]?.allowed).toBe(false);
    }
  });

  test("automation roles separate owner-authored logic from agent run state", async () => {
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_table_privilege('context_use_mcp','automation_skill_versions','INSERT') AS allowed",
    )).rows[0]?.allowed).toBe(false);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','cron_schedules','cron_expression','UPDATE') AS allowed",
    )).rows[0]?.allowed).toBe(false);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','automation_runs','status','UPDATE') AS allowed",
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_dashboard','automation_runs','status','UPDATE') AS allowed",
    )).rows[0]?.allowed).toBe(false);
  });

  test("auth role cannot read knowledge tables", async () => {
    const result = await admin.query<{ allowed: boolean }>(
      "SELECT has_table_privilege('context_use_auth', 'knowledge_pages', 'SELECT') AS allowed",
    );
    expect(result.rows[0]?.allowed).toBe(false);
  });

  test("audit history is not stored", async () => {
    const result = await admin.query<{ security_audit: string | null; publication_audit: string | null }>(
      `SELECT to_regclass('security_audit_events')::text AS security_audit,
              to_regclass('publication_events')::text AS publication_audit`,
    );
    expect(result.rows[0]).toEqual({ security_audit: null, publication_audit: null });
  });

  test("public role is denied every private base table", async () => {
    const tables = await admin.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_type='BASE TABLE'`,
    );
    for (const { table_name } of tables.rows) {
      const result = await admin.query<{ allowed: boolean }>(
        "SELECT has_table_privilege('context_use_public', format('%I', $1::text), 'SELECT') AS allowed",
        [table_name],
      );
      expect(result.rows[0]?.allowed).toBe(false);
    }
  });

  test("publication procedure is the only successful private-to-public transition", async () => {
    const pageId = randomUUID();
    const versionId = randomUUID();
    const intentId = randomUUID();
    await admin.query("BEGIN");
    try {
      await admin.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id) VALUES ($1,'test/security-boundary',$2)`,
        [pageId, versionId],
      );
      await admin.query(
        `INSERT INTO knowledge_page_versions(id,page_id,version_number,path,title,body_markdown,commit_message,actor_kind,actor_subject)
         VALUES ($1,$2,1,'test/security-boundary','Boundary','Private body','Create fixture','dashboard','test-owner')`,
        [versionId, pageId],
      );
      await admin.query(
        `INSERT INTO publication_intents(id,action,target_kind,target_id,version_id,public_slug,owner_user_id,session_id,challenge,payload_hash,expires_at)
         VALUES ($1,'publish','page',$2,$3,'security-boundary','owner','session',$5,$4,now()+interval '5 minutes')`,
        [intentId, pageId, versionId, "a".repeat(64), `challenge-${intentId}`],
      );

      for (const role of ["context_use_dashboard", "context_use_mcp"]) {
        await admin.query(`SET LOCAL ROLE ${role}`);
        await expectDenied("UPDATE knowledge_pages SET public_slug='bypass' WHERE id=$1", [pageId]);
        await admin.query("RESET ROLE");
      }

      await admin.query("SET LOCAL ROLE context_use_publisher");
      await admin.query("SELECT confirm_publication_intent($1,'owner','session','verified-credential')", [intentId]);
      await expectDenied("UPDATE knowledge_pages SET current_path='publisher-cannot-edit' WHERE id=$1", [pageId]);
      await admin.query("RESET ROLE");

      const published = await admin.query("SELECT 1 FROM published_pages WHERE id=$1 AND published_version_id=$2", [pageId, versionId]);
      expect(published.rowCount).toBe(1);
      await expect(admin.query("SELECT confirm_publication_intent($1,'owner','session','verified-credential')", [intentId])).rejects.toThrow();
    } finally {
      await admin.query("ROLLBACK");
    }
  });
});
