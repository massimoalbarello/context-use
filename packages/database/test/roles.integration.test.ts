import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client, type Pool } from "pg";
import { randomUUID } from "node:crypto";
import { InboxRepository, PublicMcpRepository, PublicMessageRepository } from "../src/index.ts";

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
    for (const role of ["context_use_mcp", "context_use_dashboard", "context_use_public", "context_use_public_mcp", "context_use_auth"]) {
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

  test("public MCP role can read only its lossy page projection", async () => {
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_table_privilege('context_use_public_mcp','public_mcp_pages','SELECT') AS allowed",
    )).rows[0]?.allowed).toBe(true);
    for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_table_privilege('context_use_public_mcp','public_mcp_pages',$1) AS allowed",
        [privilege],
      )).rows[0]?.allowed).toBe(false);
    }
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_schema_privilege('context_use_public_mcp','public','CREATE') AS allowed",
    )).rows[0]?.allowed).toBe(false);
    for (const role of ["context_use_auth", "context_use_dashboard", "context_use_mcp", "context_use_public", "context_use_publisher", "context_use_backup"]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT pg_has_role('context_use_public_mcp',$1,'MEMBER') AS allowed",
        [role],
      )).rows[0]?.allowed).toBe(false);
    }
    for (const relation of ["knowledge_pages", "knowledge_page_versions", "assets", "published_pages", "published_assets"]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_table_privilege('context_use_public_mcp',$1,'SELECT') AS allowed",
        [relation],
      )).rows[0]?.allowed).toBe(false);
    }
    const columns = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='public_mcp_pages'
       ORDER BY ordinal_position`,
    );
    expect(columns.rows.map(({ column_name }) => column_name)).toEqual([
      "public_slug", "title", "body_markdown", "parent_slug",
    ]);
  });

  test("public MCP can deliver messages but cannot read them or choose their owner", async () => {
    await admin.query("BEGIN");
    try {
      await admin.query(
        `INSERT INTO "user"(id,name,email,"emailVerified")
         VALUES ('context-use-owner','Owner','message-role-test@example.invalid',true)
         ON CONFLICT (id) DO NOTHING`,
      );

      for (const column of ["id", "reply_to", "message"]) {
        expect((await admin.query<{ allowed: boolean }>(
          "SELECT has_column_privilege('context_use_public_mcp','inbound_messages',$1,'INSERT') AS allowed",
          [column],
        )).rows[0]?.allowed).toBe(true);
      }
      for (const column of ["owner_user_id", "created_at"]) {
        expect((await admin.query<{ allowed: boolean }>(
          "SELECT has_column_privilege('context_use_public_mcp','inbound_messages',$1,'INSERT') AS allowed",
          [column],
        )).rows[0]?.allowed).toBe(false);
      }
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_table_privilege('context_use_public_mcp','inbound_messages','SELECT') AS allowed",
      )).rows[0]?.allowed).toBe(false);
      for (const role of ["context_use_auth", "context_use_mcp", "context_use_public", "context_use_publisher"]) {
        expect((await admin.query<{ allowed: boolean }>(
          "SELECT has_table_privilege($1,'inbound_messages','SELECT') AS allowed",
          [role],
        )).rows[0]?.allowed).toBe(false);
      }

      await admin.query("SET LOCAL ROLE context_use_public_mcp");
      const publicMessages = new PublicMessageRepository(admin as unknown as Pool);
      const receipt = await publicMessages.create("sender@example.com", "PRIVATE-INBOX-CANARY");
      await expectDenied("SELECT * FROM inbound_messages");
      await expectDenied(
        "INSERT INTO inbound_messages(id,reply_to,message) VALUES ($1,'sender@example.com','returning probe') RETURNING id",
        [randomUUID()],
      );
      await expectDenied(
        "INSERT INTO inbound_messages(id,owner_user_id,reply_to,message) VALUES ($1,'attacker','sender@example.com','wrong owner')",
        [randomUUID()],
      );
      await admin.query("RESET ROLE");

      const stored = await admin.query(
        "SELECT owner_user_id,reply_to,message FROM inbound_messages WHERE id=$1",
        [receipt.id],
      );
      expect(stored.rows[0]).toEqual({
        owner_user_id: "context-use-owner",
        reply_to: "sender@example.com",
        message: "PRIVATE-INBOX-CANARY",
      });

      await admin.query("SET LOCAL ROLE context_use_dashboard");
      const inbox = new InboxRepository(admin as unknown as Pool);
      expect((await inbox.listForOwner("context-use-owner")).some(({ id }) => id === receipt.id)).toBe(true);
      expect(await inbox.listForOwner("not-the-owner")).toEqual([]);
      await expectDenied(
        "INSERT INTO inbound_messages(id,reply_to,message) VALUES ($1,'sender@example.com','dashboard write')",
        [randomUUID()],
      );
      await admin.query("RESET ROLE");
    } finally {
      await admin.query("ROLLBACK");
    }
  });

  test("MCP can create asset upload intents without editing or deleting assets", async () => {
    for (const column of ["id", "current_path", "filename", "content_type", "size_bytes", "content_hash", "s3_object_key", "width", "height", "duration_seconds"]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_column_privilege('context_use_mcp', 'assets', $1, 'INSERT') AS allowed",
        [column],
      )).rows[0]?.allowed).toBe(true);
    }
    for (const column of ["published_at", "deleted_at"]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_column_privilege('context_use_mcp', 'assets', $1, 'INSERT') AS allowed",
        [column],
      )).rows[0]?.allowed).toBe(false);
    }
    for (const privilege of ["UPDATE", "DELETE"]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_table_privilege('context_use_mcp', 'assets', $1) AS allowed",
        [privilege],
      )).rows[0]?.allowed).toBe(false);
    }
  });

  test("automation roles allow MCP creation without granting definition updates", async () => {
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','automation_skills','name','INSERT') AS allowed",
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','automation_skill_versions','instructions_markdown','INSERT') AS allowed",
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','automation_skill_versions','description','INSERT') AS allowed",
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','cron_schedules','cron_expression','INSERT') AS allowed",
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','cron_schedules','cron_expression','UPDATE') AS allowed",
    )).rows[0]?.allowed).toBe(false);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','automation_skills','name','UPDATE') AS allowed",
    )).rows[0]?.allowed).toBe(false);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','automation_runs','status','UPDATE') AS allowed",
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_dashboard','automation_runs','status','UPDATE') AS allowed",
    )).rows[0]?.allowed).toBe(false);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','knowledge_pages','automation_id','INSERT') AS allowed",
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','knowledge_pages','automation_id','UPDATE') AS allowed",
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

  test("anonymous public roles are denied every private base table", async () => {
    const tables = await admin.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_type='BASE TABLE'`,
    );
    for (const role of ["context_use_public", "context_use_public_mcp"]) {
      for (const { table_name } of tables.rows) {
        const result = await admin.query<{ allowed: boolean }>(
          "SELECT has_table_privilege($1, format('%I', $2::text), 'SELECT') AS allowed",
          [role, table_name],
        );
        expect(result.rows[0]?.allowed).toBe(false);
      }
    }
  });

  test("public MCP projection redacts private references and links only published ancestors", async () => {
    const privatePageId = randomUUID();
    const privateVersionId = randomUUID();
    const parentPageId = randomUUID();
    const parentVersionId = randomUUID();
    const childPageId = randomUUID();
    const childVersionId = randomUUID();
    const assetId = randomUUID();
    await admin.query("BEGIN");
    try {
      await admin.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id)
         VALUES ($1,'about/work',$2)`,
        [privatePageId, privateVersionId],
      );
      await admin.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,body_markdown,commit_message,actor_kind,actor_subject
         ) VALUES ($1,$2,1,'about/work','PRIVATE-CANARY title','PRIVATE-CANARY body','Create private page','dashboard','owner')`,
        [privateVersionId, privatePageId],
      );
      await admin.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id,published_version_id,public_slug)
         VALUES ($1,'about',$2,$2,'about')`,
        [parentPageId, parentVersionId],
      );
      await admin.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,body_markdown,commit_message,actor_kind,actor_subject
         ) VALUES ($1,$2,1,'about','About','Public parent','Create public parent','dashboard','owner')`,
        [parentVersionId, parentPageId],
      );
      await admin.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id,published_version_id,public_slug)
         VALUES ($1,'about/work/project',$2,$2,'project')`,
        [childPageId, childVersionId],
      );
      await admin.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,body_markdown,commit_message,actor_kind,actor_subject
         ) VALUES (
           $1,$2,1,'about/work/project','Project',
           $3,'Create public child','dashboard','owner'
         )`,
        [
          childVersionId,
          childPageId,
          [
            "PUBLIC-CANARY content",
            `[Private label](context-use://page/${privatePageId})`,
            `![Private image](context-use://asset/${assetId})`,
            "[[private/strategy]]",
            "[[private/strategy|Authored label]]",
            `context-use://page/${privatePageId}`,
            "<!-- COMMENT-CANARY -->",
            "<script>SCRIPT-CANARY</script>",
            "<style>STYLE-CANARY</style>",
            "<meta name=private content=ATTRIBUTE-CANARY>",
            "<span data-private=ATTRIBUTE-CANARY>Visible span text</span>",
            "<script>UNCLOSED-SCRIPT-CANARY",
          ].join("\n\n"),
        ],
      );

      await admin.query("SET LOCAL ROLE context_use_public_mcp");
      const repository = new PublicMcpRepository(admin as unknown as Pool);
      const projected = await admin.query<{
        public_slug: string;
        title: string;
        body_markdown: string;
        parent_slug: string | null;
      }>("SELECT public_slug,title,body_markdown,parent_slug FROM public_mcp_pages ORDER BY public_slug");
      expect((await repository.listPages()).map(({ slug }) => slug)).toEqual(["about", "project"]);
      expect(await repository.getPage("project")).toMatchObject({ slug: "project", parent_slug: "about" });
      expect((await repository.searchPages("content", 10)).map(({ slug }) => slug)).toEqual(["project"]);
      await expectDenied("SELECT * FROM published_pages");
      await admin.query("RESET ROLE");

      expect(projected.rows.map(({ public_slug }) => public_slug)).toEqual(["about", "project"]);
      const child = projected.rows.find(({ public_slug }) => public_slug === "project");
      expect(child).toMatchObject({ title: "Project", parent_slug: "about" });
      expect(child?.body_markdown).toContain("PUBLIC-CANARY content");
      expect(child?.body_markdown).toContain("Private label");
      expect(child?.body_markdown).toContain("Authored label");
      expect(child?.body_markdown).not.toContain(privatePageId);
      expect(child?.body_markdown).not.toContain(assetId);
      expect(child?.body_markdown).not.toContain("private/strategy");
      expect(child?.body_markdown).not.toContain("context-use://");
      expect(child?.body_markdown).not.toContain("COMMENT-CANARY");
      expect(child?.body_markdown).not.toContain("SCRIPT-CANARY");
      expect(child?.body_markdown).not.toContain("STYLE-CANARY");
      expect(child?.body_markdown).not.toContain("ATTRIBUTE-CANARY");
      expect(child?.body_markdown).toContain("Visible span text");
      expect(JSON.stringify(projected.rows)).not.toContain("PRIVATE-CANARY");
      expect(JSON.stringify(projected.rows)).not.toContain("about/work");
    } finally {
      await admin.query("ROLLBACK");
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
