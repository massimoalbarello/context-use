import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client, type Pool } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { PublicRepository } from "../src/index.ts";

const adminUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = adminUrl ? describe : describe.skip;

describeDatabase("PostgreSQL security roles", () => {
  let admin: Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    for (const [path, title] of [["test", "Test"], ["tests", "Tests"], ["profile", "Profile"], ["profile/work", "Work"]]) {
      await admin.query(
        `INSERT INTO knowledge_directories(id,current_path,title,summary,intro_markdown,search_vector)
         VALUES ($1,$2,$3,$4,'',directory_search_vector($2,$3,$4,''))
         ON CONFLICT (current_path) DO NOTHING`,
        [randomUUID(), path, title, `Fixtures under ${path}.`],
      );
    }
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

  const challenge = (): string => randomBytes(32).toString("base64url");

  async function ensureOwnerPasskey(counter = 0): Promise<void> {
    await admin.query(
      `INSERT INTO "user"(id,name,email,"emailVerified")
       VALUES ('context-use-owner','Owner','owner@example.invalid',true)
       ON CONFLICT (id) DO NOTHING`,
    );
    await admin.query(
      `INSERT INTO passkey(
         id,name,"publicKey","userId","credentialID",counter,"deviceType","backedUp",transports,"createdAt",aaguid
       ) VALUES (
         'test-passkey','Owner passkey','test-public-key','context-use-owner',
         'test-credential',$1,'singleDevice',false,'internal',now(),'test-aaguid'
       ) ON CONFLICT (id) DO NOTHING`,
      [counter],
    );
  }

  async function issueChallenge(
    kind: "publication" | "knowledge_export" | "page_deletion",
    intentId: string,
    value = challenge(),
  ): Promise<string> {
    await admin.query("SET LOCAL ROLE context_use_confirmation");
    await admin.query(
      "SELECT issue_confirmation_challenge($1,$2,$3)",
      [kind, intentId, value],
    );
    await admin.query("RESET ROLE");
    return value;
  }

  test("MCP and dashboard roles cannot update publication columns", async () => {
    for (const role of ["context_use_mcp", "context_use_dashboard"]) {
      const privilege = await admin.query<{ allowed: boolean }>(
        "SELECT has_column_privilege($1, 'knowledge_pages', 'published_version_id', 'UPDATE') AS allowed",
        [role],
      );
      expect(privilege.rows[0]?.allowed).toBe(false);
      const path = await admin.query<{ allowed: boolean }>(
        "SELECT has_column_privilege($1, 'knowledge_pages', 'public_path', 'UPDATE') AS allowed",
        [role],
      );
      expect(path.rows[0]?.allowed).toBe(false);
    }
  });

  test("full-text search indexes only the current page projection", async () => {
    const indexes = await admin.query<{ current_index: string | null; historical_index: string | null }>(
      `SELECT to_regclass('knowledge_pages_search_idx')::text AS current_index,
              to_regclass('knowledge_page_versions_search_idx')::text AS historical_index`,
    );
    expect(indexes.rows[0]).toEqual({
      current_index: "knowledge_pages_search_idx",
      historical_index: null,
    });
    expect((await admin.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='knowledge_pages' AND column_name='search_vector'`,
    )).rowCount).toBe(1);
    expect((await admin.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='knowledge_page_versions' AND column_name='search_vector'`,
    )).rowCount).toBe(0);
  });

  test("only confirmation role can issue challenges and execute visibility procedures", async () => {
    const functions = [
      "issue_confirmation_challenge(confirmation_intent_kind,uuid,text)",
      "confirm_publication_intent(uuid,text,text,text,integer,integer)",
      "confirm_page_deletion_intent(uuid,text,text,text,integer,integer)",
    ];
    for (const role of ["context_use_mcp", "context_use_dashboard", "context_use_public", "context_use_auth", "context_use_storage", "context_use_backup"]) {
      for (const fn of functions) {
        const result = await admin.query<{ allowed: boolean }>(
          "SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",
          [role, fn],
        );
        expect(result.rows[0]?.allowed).toBe(false);
      }
    }
    for (const fn of functions) {
      const confirmation = await admin.query<{ allowed: boolean }>(
        "SELECT has_function_privilege('context_use_confirmation',$1,'EXECUTE') AS allowed",
        [fn],
      );
      expect(confirmation.rows[0]?.allowed).toBe(true);
    }
  });

  test("page writers can invoke fixed retention without receiving history deletion access", async () => {
    for (const role of ["context_use_dashboard", "context_use_mcp"]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_function_privilege($1,'prune_page_versions(uuid)','EXECUTE') AS allowed",
        [role],
      )).rows[0]?.allowed).toBe(true);
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_table_privilege($1,'knowledge_page_versions','DELETE') AS allowed",
        [role],
      )).rows[0]?.allowed).toBe(false);
    }
    for (const role of ["context_use_auth", "context_use_public", "context_use_confirmation", "context_use_storage"]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_function_privilege($1,'prune_page_versions(uuid)','EXECUTE') AS allowed",
        [role],
      )).rows[0]?.allowed).toBe(false);
    }
  });

  test("only the dashboard can stage a permanent page deletion", async () => {
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_any_column_privilege('context_use_dashboard','page_deletion_intents','INSERT') AS allowed",
    )).rows[0]?.allowed).toBe(true);
    for (const role of ["context_use_auth", "context_use_mcp", "context_use_public", "context_use_confirmation", "context_use_storage", "context_use_backup"]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_any_column_privilege($1,'page_deletion_intents','INSERT') AS allowed",
        [role],
      )).rows[0]?.allowed).toBe(false);
    }
    const pageId = randomUUID();
    const versionId = randomUUID();
    await admin.query("BEGIN");
    try {
      await admin.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id,archived_at)
         VALUES ($1,'test/dashboard-deletion-intent',$2,now())`,
        [pageId, versionId],
      );
      await admin.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,summary,body_markdown,commit_message,actor_kind,actor_subject
         ) VALUES ($1,$2,1,'test/dashboard-deletion-intent','Delete','A page deletion fixture.','Body','Create fixture','dashboard','owner')`,
        [versionId, pageId],
      );
      const insert = `INSERT INTO page_deletion_intents(
          id,page_id,expected_version_id,owner_user_id,session_id,expires_at
        ) VALUES ($1,$2,$3,'context-use-owner','session',now()+interval '5 minutes')`;
      await admin.query("SET LOCAL ROLE context_use_dashboard");
      await admin.query(insert, [randomUUID(), pageId, versionId]);
      await admin.query("RESET ROLE");
      await admin.query("SET LOCAL ROLE context_use_mcp");
      await expectDenied(insert, [randomUUID(), pageId, versionId]);
      await admin.query("RESET ROLE");
    } finally {
      await admin.query("ROLLBACK");
    }
  });

  test("only the passkey-confirmation role can authorize or claim a knowledge export", async () => {
    const functions = [
      "confirm_knowledge_export_intent(uuid,text,text,text,integer,integer)",
      "claim_knowledge_export_download(uuid,text,text)",
    ];
    for (const fn of functions) {
      for (const role of ["context_use_auth", "context_use_dashboard", "context_use_mcp", "context_use_public", "context_use_backup"]) {
        expect((await admin.query<{ allowed: boolean }>(
          "SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",
          [role, fn],
        )).rows[0]?.allowed).toBe(false);
      }
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_function_privilege('context_use_confirmation',$1,'EXECUTE') AS allowed",
        [fn],
      )).rows[0]?.allowed).toBe(true);
    }
    for (const column of ["confirmed_at", "download_started_at"]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_column_privilege('context_use_dashboard','knowledge_export_intents',$1,'INSERT') AS allowed",
        [column],
      )).rows[0]?.allowed).toBe(false);
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_column_privilege('context_use_dashboard','knowledge_export_intents',$1,'UPDATE') AS allowed",
        [column],
      )).rows[0]?.allowed).toBe(false);
    }
    for (const table of ["knowledge_export_intents"]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_table_privilege('context_use_confirmation',$1,'SELECT') AS allowed",
        [table],
      )).rows[0]?.allowed).toBe(false);
      for (const role of ["context_use_auth", "context_use_mcp", "context_use_public"]) {
        expect((await admin.query<{ allowed: boolean }>(
          "SELECT has_table_privilege($1,$2,'SELECT') AS allowed",
          [role, table],
        )).rows[0]?.allowed).toBe(false);
      }
    }
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_table_privilege('context_use_confirmation','publication_intents','SELECT') AS allowed",
    )).rows[0]?.allowed).toBe(false);
  });

  test("service roles cannot create database objects or assume internal owner roles", async () => {
    const serviceRoles = [
      "context_use_auth",
      "context_use_dashboard",
      "context_use_mcp",
      "context_use_public",
      "context_use_confirmation",
      "context_use_storage",
      "context_use_backup",
    ];
    for (const role of serviceRoles) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_database_privilege($1,current_database(),'CONNECT') AS allowed",
        [role],
      )).rows[0]?.allowed).toBe(true);
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_database_privilege($1,current_database(),'TEMPORARY') AS allowed",
        [role],
      )).rows[0]?.allowed).toBe(false);
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_schema_privilege($1,'public','CREATE') AS allowed",
        [role],
      )).rows[0]?.allowed).toBe(false);
      for (const ownerRole of ["context_use_projection_owner", "context_use_boundary_owner"]) {
        expect((await admin.query<{ allowed: boolean }>(
          "SELECT pg_has_role($1,$2,'MEMBER') AS allowed",
          [role, ownerRole],
        )).rows[0]?.allowed).toBe(false);
      }
    }

    const internalOwners = await admin.query<{
      rolname: string;
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolinherit: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolbypassrls
       FROM pg_roles
       WHERE rolname IN ('context_use_projection_owner','context_use_boundary_owner')
       ORDER BY rolname`,
    );
    expect(internalOwners.rows).toEqual([
      {
        rolname: "context_use_boundary_owner",
        rolcanlogin: false,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolbypassrls: false,
      },
      {
        rolname: "context_use_projection_owner",
        rolcanlogin: false,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolbypassrls: false,
      },
    ]);
  });

  test("views and privileged procedures have narrowly privileged non-login owners", async () => {
    const views = await admin.query<{ relname: string; owner: string }>(
      `SELECT relname,pg_get_userbyid(relowner) AS owner
       FROM pg_class
       WHERE relnamespace='public'::regnamespace
         AND relname IN (
           'published_page_sources','published_pages','published_assets',
           'storage_published_assets'
         )
       ORDER BY relname`,
    );
    expect(views.rows).toEqual([
      { relname: "published_assets", owner: "context_use_projection_owner" },
      { relname: "published_page_sources", owner: "context_use_projection_owner" },
      { relname: "published_pages", owner: "context_use_projection_owner" },
      { relname: "storage_published_assets", owner: "context_use_projection_owner" },
    ]);

    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_function_privilege('context_use_public','project_public_markdown(text)','EXECUTE') AS allowed",
    )).rows[0]?.allowed).toBe(true);
    for (const role of ["context_use_auth", "context_use_dashboard", "context_use_mcp", "context_use_confirmation", "context_use_storage", "context_use_backup"]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_function_privilege($1,'project_public_markdown(text)','EXECUTE') AS allowed",
        [role],
      )).rows[0]?.allowed).toBe(false);
    }

    const procedures = await admin.query<{ proname: string; owner: string; security_definer: boolean }>(
      `SELECT proname,pg_get_userbyid(proowner) AS owner,prosecdef AS security_definer
       FROM pg_proc
       WHERE pronamespace='public'::regnamespace
         AND proname IN (
           'issue_confirmation_challenge',
           'consume_confirmation_challenge',
           'confirm_publication_intent',
           'confirm_knowledge_export_intent',
           'confirm_page_deletion_intent',
           'claim_knowledge_export_download',
           'prune_page_versions',
           'project_public_markdown'
         )
       ORDER BY proname`,
    );
    expect(procedures.rows).toEqual([
      { proname: "claim_knowledge_export_download", owner: "context_use_boundary_owner", security_definer: true },
      { proname: "confirm_knowledge_export_intent", owner: "context_use_boundary_owner", security_definer: true },
      { proname: "confirm_page_deletion_intent", owner: "context_use_boundary_owner", security_definer: true },
      { proname: "confirm_publication_intent", owner: "context_use_boundary_owner", security_definer: true },
      { proname: "consume_confirmation_challenge", owner: "context_use_boundary_owner", security_definer: true },
      { proname: "issue_confirmation_challenge", owner: "context_use_boundary_owner", security_definer: true },
      { proname: "project_public_markdown", owner: "context_use_projection_owner", security_definer: true },
      { proname: "prune_page_versions", owner: "context_use_boundary_owner", security_definer: true },
    ]);

    for (const [relation, column] of [
      ["knowledge_page_versions", "body_markdown"],
      ["knowledge_page_versions", "title"],
      ["assets", "s3_object_key"],
    ]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_column_privilege('context_use_boundary_owner',$1,$2,'SELECT') AS allowed",
        [relation, column],
      )).rows[0]?.allowed).toBe(false);
    }
    for (const [relation, column] of [
      ["confirmation_challenges", "challenge"],
      ["knowledge_page_versions", "path"],
      ["knowledge_pages", "archived_at"],
      ["assets", "current_path"],
      ["knowledge_export_intents", "expires_at"],
      ["passkey", "counter"],
    ]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_column_privilege('context_use_boundary_owner',$1,$2,'SELECT') AS allowed",
        [relation, column],
      )).rows[0]?.allowed).toBe(true);
    }
  });

  test("passkey procedures reject null principals and credentials", async () => {
    const exportIntentId = randomUUID();
    await admin.query("BEGIN");
    try {
      await ensureOwnerPasskey();
      await admin.query(
        `INSERT INTO knowledge_export_intents(
           id,owner_user_id,session_id,expires_at
         ) VALUES ($1,'context-use-owner','session',now()+interval '5 minutes')`,
        [exportIntentId],
      );
      await issueChallenge("knowledge_export", exportIntentId);
      await admin.query("SET LOCAL ROLE context_use_confirmation");
      await expectDenied(
        "SELECT confirm_knowledge_export_intent($1,NULL,'session','test-credential',0,1)",
        [exportIntentId],
      );
      await expectDenied(
        "SELECT confirm_knowledge_export_intent($1,'context-use-owner',NULL,'test-credential',0,1)",
        [exportIntentId],
      );
      await expectDenied(
        "SELECT confirm_knowledge_export_intent($1,'context-use-owner','session',NULL,0,1)",
        [exportIntentId],
      );
      await admin.query(
        "SELECT confirm_knowledge_export_intent($1,'context-use-owner','session','test-credential',0,1)",
        [exportIntentId],
      );
      await expectDenied(
        "SELECT claim_knowledge_export_download($1,NULL,'session')",
        [exportIntentId],
      );
      await expectDenied(
        "SELECT claim_knowledge_export_download($1,'context-use-owner',NULL)",
        [exportIntentId],
      );
      await admin.query("RESET ROLE");
    } finally {
      await admin.query("ROLLBACK");
    }
  });

  test("intent constraints enforce the owner and five-minute lifetime", async () => {
    await admin.query("BEGIN");
    try {
      await expectDenied(
        `INSERT INTO knowledge_export_intents(
           id,owner_user_id,session_id,expires_at
         ) VALUES ($1,'not-the-owner','session',now()+interval '5 minutes')`,
        [randomUUID()],
      );
      const pageId = randomUUID();
      const versionId = randomUUID();
      await admin.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id,archived_at)
         VALUES ($1,'test/deletion-intent-constraints',$2,now())`,
        [pageId, versionId],
      );
      await admin.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,summary,body_markdown,commit_message,actor_kind,actor_subject
         ) VALUES ($1,$2,1,'test/deletion-intent-constraints','Delete','A deletion constraint fixture.','Body','Create fixture','dashboard','owner')`,
        [versionId, pageId],
      );
      await expectDenied(
        `INSERT INTO page_deletion_intents(
           id,page_id,expected_version_id,owner_user_id,session_id,expires_at
         ) VALUES ($1,$2,$3,'not-the-owner','session',now()+interval '5 minutes')`,
        [randomUUID(), pageId, versionId],
      );
      await expectDenied(
        `INSERT INTO page_deletion_intents(
           id,page_id,expected_version_id,owner_user_id,session_id,expires_at
         ) VALUES ($1,$2,$3,'context-use-owner','session',now()+interval '5 minutes 1 second')`,
        [randomUUID(), pageId, versionId],
      );
      await expectDenied(
        `INSERT INTO knowledge_export_intents(
           id,owner_user_id,session_id,expires_at
         ) VALUES ($1,'context-use-owner','session',now()+interval '5 minutes 1 second')`,
        [randomUUID()],
      );
    } finally {
      await admin.query("ROLLBACK");
    }
  });

  test("only passkey confirmation can permanently delete an archived page and its versions", async () => {
    const pageId = randomUUID();
    const firstVersionId = randomUUID();
    const currentVersionId = randomUUID();
    const intentId = randomUUID();
    await admin.query("BEGIN");
    try {
      await ensureOwnerPasskey();
      await admin.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id,archived_at)
         VALUES ($1,'test/permanent-page-deletion',$2,now())`,
        [pageId, currentVersionId],
      );
      await admin.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,summary,body_markdown,commit_message,actor_kind,actor_subject
         ) VALUES
           ($1,$3,1,'test/permanent-page-deletion','Delete me','A permanently deleted page fixture.','First','Create fixture','dashboard','owner'),
           ($2,$3,2,'test/permanent-page-deletion','Delete me','A permanently deleted page fixture.','Archived','Archive fixture','dashboard','owner')`,
        [firstVersionId, currentVersionId, pageId],
      );
      await admin.query(
        `INSERT INTO page_deletion_intents(
           id,page_id,expected_version_id,owner_user_id,session_id,expires_at
         ) VALUES ($1,$2,$3,'context-use-owner','session',now()+interval '5 minutes')`,
        [intentId, pageId, currentVersionId],
      );

      for (const role of ["context_use_dashboard", "context_use_mcp"]) {
        await admin.query(`SET LOCAL ROLE ${role}`);
        await expectDenied("DELETE FROM knowledge_page_versions WHERE page_id=$1", [pageId]);
        await expectDenied("DELETE FROM knowledge_pages WHERE id=$1", [pageId]);
        await expectDenied(
          "SELECT confirm_page_deletion_intent($1,'context-use-owner','session','test-credential',0,1)",
          [intentId],
        );
        await admin.query("RESET ROLE");
      }

      await issueChallenge("page_deletion", intentId);
      await admin.query("SET LOCAL ROLE context_use_confirmation");
      await admin.query(
        "SELECT confirm_page_deletion_intent($1,'context-use-owner','session','test-credential',0,1)",
        [intentId],
      );
      await admin.query("RESET ROLE");

      expect((await admin.query("SELECT 1 FROM knowledge_pages WHERE id=$1", [pageId])).rowCount).toBe(0);
      expect((await admin.query("SELECT 1 FROM knowledge_page_versions WHERE page_id=$1", [pageId])).rowCount).toBe(0);
      expect((await admin.query("SELECT 1 FROM page_deletion_intents WHERE id=$1", [intentId])).rowCount).toBe(0);
      expect((await admin.query("SELECT counter FROM passkey WHERE id='test-passkey'")).rows[0]?.counter).toBe(1);
    } finally {
      await admin.query("ROLLBACK");
    }
  });

  test("the private guide defines optional owner context and page-backed skill discovery", async () => {
    expect((await admin.query(
      "SELECT 1 FROM knowledge_pages WHERE current_path='about/intro'",
    )).rowCount).toBe(0);
    expect((await admin.query(
      `SELECT 1
       FROM knowledge_pages page
       JOIN knowledge_page_versions version ON version.id=page.current_version_id
       WHERE page.current_path='agents' AND page.archived_at IS NULL
         AND version.title='AGENTS.md'
         AND version.body_markdown LIKE '%Create %about/intro%if it is missing%'
         AND version.body_markdown LIKE '%ask them to review and publish %about/intro%'
         AND version.body_markdown LIKE '%Every directory is a first-class, linkable resource%'
         AND version.body_markdown LIKE '%Do not create or manually maintain %index%pages%'
         AND version.body_markdown LIKE '%Local guides are optional%'
         AND version.body_markdown LIKE '%skills/<skill-name>%'
         AND version.body_markdown LIKE '%complete standard %SKILL.md%'`,
    )).rowCount).toBe(1);
  });

  test("the root AGENTS.md page cannot be moved, archived, or permanently deleted", async () => {
    const guide = await admin.query<{ id: string }>(
      "SELECT id FROM knowledge_pages WHERE current_path='agents'",
    );
    const guideId = guide.rows[0]!.id;
    await admin.query("BEGIN");
    try {
      for (const role of ["context_use_dashboard", "context_use_mcp"]) {
        await admin.query(`SET LOCAL ROLE ${role}`);
        await expectDenied(
          "UPDATE knowledge_pages SET current_path='test/moved-root-guide' WHERE id=$1",
          [guideId],
        );
        await expectDenied(
          "UPDATE knowledge_pages SET archived_at=now() WHERE id=$1",
          [guideId],
        );
        await admin.query("RESET ROLE");
      }
      await admin.query("SET LOCAL ROLE context_use_boundary_owner");
      await expectDenied("DELETE FROM knowledge_pages WHERE id=$1", [guideId]);
      await admin.query("RESET ROLE");
    } finally {
      await admin.query("ROLLBACK");
    }
  });

  test("public role can see publication views but not private base tables", async () => {
    for (const relation of ["knowledge_directories", "knowledge_pages", "assets"]) {
      const result = await admin.query<{ allowed: boolean }>(
        "SELECT has_table_privilege('context_use_public', $1, 'SELECT') AS allowed",
        [relation],
      );
      expect(result.rows[0]?.allowed).toBe(false);
    }
    for (const relation of ["published_pages", "published_assets"]) {
      const result = await admin.query<{ allowed: boolean }>(
        "SELECT has_table_privilege('context_use_public', $1, 'SELECT') AS allowed",
        [relation],
      );
      expect(result.rows[0]?.allowed).toBe(true);
    }
    for (const relation of ["published_page_sources", "storage_published_assets"]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_table_privilege('context_use_public',$1,'SELECT') AS allowed",
        [relation],
      )).rows[0]?.allowed).toBe(false);
    }
    const publicPageColumns = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='published_pages'
       ORDER BY ordinal_position`,
    );
    expect(publicPageColumns.rows.map(({ column_name }) => column_name)).toEqual([
      "public_path", "title", "summary", "body_markdown", "last_edited_at",
    ]);
    const publicAssetColumns = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='published_assets'
       ORDER BY ordinal_position`,
    );
    expect(publicAssetColumns.rows.map(({ column_name }) => column_name)).toEqual([
      "public_path", "filename", "content_type", "size_bytes",
    ]);
  });

  test("storage role can validate asset bytes but cannot read knowledge or mutate metadata", async () => {
    for (const column of [
      "id", "s3_object_key", "filename", "content_type", "size_bytes", "content_hash", "deleted_at",
    ]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_column_privilege('context_use_storage','assets',$1,'SELECT') AS allowed",
        [column],
      )).rows[0]?.allowed).toBe(true);
    }
    for (const relation of ["knowledge_directories", "knowledge_pages", "knowledge_page_versions"]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_table_privilege('context_use_storage',$1,'SELECT') AS allowed",
        [relation],
      )).rows[0]?.allowed).toBe(false);
    }
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_table_privilege('context_use_storage','assets','SELECT') AS allowed",
    )).rows[0]?.allowed).toBe(false);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_table_privilege('context_use_storage','storage_published_assets','SELECT') AS allowed",
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_table_privilege('context_use_storage','published_assets','SELECT') AS allowed",
    )).rows[0]?.allowed).toBe(false);
    for (const privilege of ["INSERT", "UPDATE", "DELETE"]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_table_privilege('context_use_storage','assets',$1) AS allowed",
        [privilege],
      )).rows[0]?.allowed).toBe(false);
    }
  });

  test("published assets resolve by knowledge path while private assets stay absent", async () => {
    const publishedAssetId = randomUUID();
    const privateAssetId = randomUUID();
    const intentId = randomUUID();
    const suffix = randomUUID().slice(0, 8);
    const publishedPath = `tests/${suffix}/nested/public-asset`;
    const privatePath = `tests/${suffix}/nested/private-asset`;
    await admin.query("BEGIN");
    try {
      await ensureOwnerPasskey();
      await admin.query(
        `INSERT INTO assets(id,current_path,filename,content_type,size_bytes,content_hash,s3_object_key)
         VALUES
           ($1,$2,'public.png','image/png',1,$3,$4),
           ($5,$6,'private.png','image/png',1,$3,$7)`,
        [publishedAssetId, publishedPath, "a".repeat(64), `objects/${publishedAssetId}`, privateAssetId, privatePath, `objects/${privateAssetId}`],
      );
      await admin.query(
        `INSERT INTO publication_intents(
           id,action,target_kind,target_id,public_path,owner_user_id,session_id,
           expires_at
         ) VALUES ($1,'publish','asset',$2,$3,'context-use-owner','session',now()+interval '5 minutes')`,
        [intentId, publishedAssetId, publishedPath],
      );

      await admin.query("SET LOCAL ROLE context_use_public");
      const publicAssets = new PublicRepository(admin as unknown as Pool);
      expect(await publicAssets.assetByPublicPath(publishedPath)).toBeNull();
      expect(await publicAssets.assetByPublicPath(privatePath)).toBeNull();
      await admin.query("RESET ROLE");

      await issueChallenge("publication", intentId);
      await admin.query("SET LOCAL ROLE context_use_confirmation");
      await admin.query("SELECT confirm_publication_intent($1,'context-use-owner','session','test-credential',0,1)", [intentId]);
      await admin.query("RESET ROLE");

      await admin.query("SET LOCAL ROLE context_use_public");
      expect(await publicAssets.assetByPublicPath(publishedPath)).toMatchObject({
        public_path: publishedPath,
        filename: "public.png",
      });
      expect(await publicAssets.assetByPublicPath(privatePath)).toBeNull();
      await expectDenied("SELECT * FROM assets");
    } finally {
      await admin.query("ROLLBACK");
    }
  });

  test("service roles cannot archive or delete an object while it is published", async () => {
    const pageId = randomUUID();
    const versionId = randomUUID();
    const assetId = randomUUID();
    const suffix = randomUUID().slice(0, 8);
    await admin.query("BEGIN");
    try {
      await admin.query(
        `INSERT INTO knowledge_directories(id,current_path,title,summary,intro_markdown,search_vector)
         VALUES ($1,$2,'Lifecycle fixture','A directory for publication lifecycle tests.','',directory_search_vector($2,'Lifecycle fixture','A directory for publication lifecycle tests.',''))`,
        [randomUUID(), `tests/${suffix}`],
      );
      await admin.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id,published_version_id,public_path)
         VALUES ($1,$2,$3,$3,$2)`,
        [pageId, `tests/${suffix}/published-page`, versionId],
      );
      await admin.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,summary,body_markdown,commit_message,actor_kind,actor_subject
         ) VALUES ($1,$2,1,$3,'Published lifecycle','A published lifecycle fixture.','Public','Create','dashboard','owner')`,
        [versionId, pageId, `tests/${suffix}/published-page`],
      );
      await admin.query(
        `INSERT INTO assets(
           id,current_path,public_path,filename,content_type,size_bytes,
           content_hash,s3_object_key
         ) VALUES ($1,$2,$2,'published.txt','text/plain',1,$3,$4)`,
        [assetId, `tests/${suffix}/published-asset`, "b".repeat(64), `objects/${assetId}`],
      );

      for (const role of ["context_use_dashboard", "context_use_mcp"]) {
        await admin.query(`SET LOCAL ROLE ${role}`);
        await expectDenied("UPDATE knowledge_pages SET archived_at=now() WHERE id=$1", [pageId]);
        await admin.query("RESET ROLE");
      }
      await admin.query("SET LOCAL ROLE context_use_dashboard");
      await expectDenied("UPDATE assets SET deleted_at=now() WHERE id=$1", [assetId]);
      await admin.query("RESET ROLE");

      // Once the passkey-owned visibility fields have been cleared, ordinary
      // private lifecycle operations are valid again.
      await admin.query(
        "UPDATE knowledge_pages SET published_version_id=NULL,public_path=NULL WHERE id=$1",
        [pageId],
      );
      await admin.query(
        "UPDATE assets SET public_path=NULL WHERE id=$1",
        [assetId],
      );
      await admin.query("SET LOCAL ROLE context_use_dashboard");
      expect((await admin.query(
        "UPDATE knowledge_pages SET archived_at=now() WHERE id=$1",
        [pageId],
      )).rowCount).toBe(1);
      expect((await admin.query(
        "UPDATE assets SET deleted_at=now() WHERE id=$1",
        [assetId],
      )).rowCount).toBe(1);
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
    for (const column of ["public_path", "deleted_at"]) {
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

  test("automation roles allow independent creation without definition updates", async () => {
    expect((await admin.query<{ removed: boolean }>(
      "SELECT to_regclass('agent_skills') IS NULL AND to_regclass('agent_skill_versions') IS NULL AS removed",
    )).rows[0]?.removed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','automation_versions','instructions_markdown','INSERT') AS allowed",
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','automation_versions','instructions_markdown','UPDATE') AS allowed",
    )).rows[0]?.allowed).toBe(false);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_dashboard','automation_versions','instructions_markdown','INSERT') AS allowed",
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_dashboard','automation_versions','instructions_markdown','UPDATE') AS allowed",
    )).rows[0]?.allowed).toBe(false);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','cron_schedules','cron_expression','INSERT') AS allowed",
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','cron_schedules','automation_key','INSERT') AS allowed",
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','cron_schedules','current_version_id','INSERT') AS allowed",
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','cron_schedules','instructions_page_id','INSERT') AS allowed",
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','cron_schedules','automation_key','UPDATE') AS allowed",
    )).rows[0]?.allowed).toBe(false);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','cron_schedules','cron_expression','UPDATE') AS allowed",
    )).rows[0]?.allowed).toBe(false);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_dashboard','cron_schedules','deleted_at','UPDATE') AS allowed",
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','automation_runs','status','UPDATE') AS allowed",
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','automation_runs','automation_version_id','INSERT') AS allowed",
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_dashboard','automation_runs','status','UPDATE') AS allowed",
    )).rows[0]?.allowed).toBe(false);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','knowledge_pages','automation_id','INSERT') AS allowed",
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_dashboard','knowledge_pages','automation_id','INSERT') AS allowed",
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','knowledge_pages','automation_id','UPDATE') AS allowed",
    )).rows[0]?.allowed).toBe(false);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_any_column_privilege('context_use_mcp','publication_intents','INSERT') AS allowed",
    )).rows[0]?.allowed).toBe(false);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_any_column_privilege('context_use_dashboard','publication_intents','INSERT') AS allowed",
    )).rows[0]?.allowed).toBe(true);
  });

  test("completed automation history uses concise summaries and keyset pagination storage", async () => {
    const constraint = await admin.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid='automation_runs'::regclass
         AND conname='automation_runs_result_summary_check'`,
    );
    expect(constraint.rows[0]?.definition).toContain("length(result_summary) <= 500");

    const index = await admin.query<{ definition: string; valid: boolean }>(
      `SELECT pg_get_indexdef(indexrelid) AS definition,indisvalid AS valid
       FROM pg_index
       WHERE indexrelid='automation_runs_completed_idx'::regclass`,
    );
    expect(index.rows[0]?.valid).toBe(true);
    expect(index.rows[0]?.definition).toContain("(completed_at DESC, id DESC)");
    expect(index.rows[0]?.definition).toContain("'succeeded'");
    expect(index.rows[0]?.definition).toContain("'failed'");
  });

  test("auth role cannot read knowledge tables", async () => {
    const result = await admin.query<{ allowed: boolean }>(
      "SELECT has_table_privilege('context_use_auth', 'knowledge_pages', 'SELECT') AS allowed",
    );
    expect(result.rows[0]?.allowed).toBe(false);
  });

  test("auth can advance replay state but cannot replace owner or passkey identity", async () => {
    await admin.query("BEGIN");
    try {
      await ensureOwnerPasskey();
      await admin.query("SET LOCAL ROLE context_use_auth");

      await admin.query("UPDATE passkey SET counter=1 WHERE id='test-passkey'");
      await admin.query("UPDATE \"user\" SET name='Updated owner' WHERE id='context-use-owner'");
      await expectDenied("UPDATE passkey SET counter=0 WHERE id='test-passkey'");
      await expectDenied("UPDATE passkey SET \"publicKey\"='attacker-key' WHERE id='test-passkey'");
      await expectDenied("UPDATE passkey SET \"credentialID\"='attacker-credential' WHERE id='test-passkey'");
      await expectDenied("UPDATE passkey SET \"userId\"='attacker' WHERE id='test-passkey'");
      await expectDenied("DELETE FROM passkey WHERE id='test-passkey'");
      await expectDenied("UPDATE \"user\" SET email='attacker@example.invalid' WHERE id='context-use-owner'");
      await expectDenied("UPDATE \"user\" SET \"emailVerified\"=false WHERE id='context-use-owner'");
      await expectDenied("DELETE FROM \"user\" WHERE id='context-use-owner'");
      await admin.query("RESET ROLE");

      expect((await admin.query(
        `SELECT "publicKey","credentialID","userId",counter
         FROM passkey WHERE id='test-passkey'`,
      )).rows[0]).toEqual({
        publicKey: "test-public-key",
        credentialID: "test-credential",
        userId: "context-use-owner",
        counter: 1,
      });
    } finally {
      await admin.query("ROLLBACK");
    }
  });

  test("confirmation challenges are isolated, globally unique, and single-use", async () => {
    const sharedId = randomUUID();
    const pageId = randomUUID();
    const versionId = randomUUID();
    const publicationChallenge = challenge();
    const exportChallenge = challenge();
    await admin.query("BEGIN");
    try {
      await ensureOwnerPasskey();
      await admin.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id)
         VALUES ($1,'test/challenge-isolation',$2)`,
        [pageId, versionId],
      );
      await admin.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,summary,body_markdown,commit_message,actor_kind,actor_subject
         ) VALUES (
           $1,$2,1,'test/challenge-isolation','Challenge isolation','A confirmation challenge isolation fixture.','Private',
           'Create fixture','dashboard','owner'
         )`,
        [versionId, pageId],
      );
      await admin.query(
        `INSERT INTO publication_intents(
           id,action,target_kind,target_id,version_id,public_path,owner_user_id,
           session_id,expires_at
         ) VALUES (
           $1,'publish','page',$2,$3,'test/challenge-isolation',
           'context-use-owner','session',now()+interval '5 minutes'
         )`,
        [sharedId, pageId, versionId],
      );
      await admin.query(
        `INSERT INTO knowledge_export_intents(id,owner_user_id,session_id,expires_at)
         VALUES ($1,'context-use-owner','session',now()+interval '5 minutes')`,
        [sharedId],
      );

      await admin.query("SET LOCAL ROLE context_use_dashboard");
      await expectDenied(
        "SELECT issue_confirmation_challenge('publication',$1,$2)",
        [sharedId, publicationChallenge],
      );
      await expectDenied(
        "INSERT INTO confirmation_challenges(intent_kind,intent_id,challenge) VALUES ('publication',$1,$2)",
        [sharedId, publicationChallenge],
      );
      await admin.query("RESET ROLE");

      await issueChallenge("publication", sharedId, publicationChallenge);
      await admin.query("SET LOCAL ROLE context_use_confirmation");
      await expectDenied(
        "SELECT issue_confirmation_challenge('publication',$1,$2)",
        [sharedId, challenge()],
      );
      await expectDenied(
        "SELECT issue_confirmation_challenge('knowledge_export',$1,$2)",
        [sharedId, publicationChallenge],
      );
      await admin.query(
        "SELECT issue_confirmation_challenge('knowledge_export',$1,$2)",
        [sharedId, exportChallenge],
      );
      await expectDenied(
        "SELECT confirm_knowledge_export_intent($1,'context-use-owner','session','test-credential',99,100)",
        [sharedId],
      );
      await admin.query(
        "SELECT confirm_publication_intent($1,'context-use-owner','session','test-credential',0,1)",
        [sharedId],
      );
      await expectDenied(
        "SELECT confirm_publication_intent($1,'context-use-owner','session','test-credential',1,2)",
        [sharedId],
      );
      await expectDenied(
        "SELECT confirm_knowledge_export_intent($1,'context-use-owner','session','test-credential',0,1)",
        [sharedId],
      );
      await admin.query(
        "SELECT confirm_knowledge_export_intent($1,'context-use-owner','session','test-credential',1,2)",
        [sharedId],
      );
      await admin.query("RESET ROLE");

      expect((await admin.query(
        "SELECT 1 FROM confirmation_challenges WHERE intent_id=$1",
        [sharedId],
      )).rowCount).toBe(0);
      expect((await admin.query("SELECT counter FROM passkey WHERE id='test-passkey'")).rows[0]?.counter).toBe(2);
    } finally {
      await admin.query("ROLLBACK");
    }
  });

  test("audit history is not stored", async () => {
    const result = await admin.query<{ security_audit: string | null; publication_audit: string | null }>(
      `SELECT to_regclass('security_audit_events')::text AS security_audit,
              to_regclass('publication_events')::text AS publication_audit`,
    );
    expect(result.rows[0]).toEqual({ security_audit: null, publication_audit: null });
  });

  test("the anonymous public role is denied every private base table", async () => {
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

  test("public webpage projection redacts private references", async () => {
    const privatePageId = randomUUID();
    const privateVersionId = randomUUID();
    const parentPageId = randomUUID();
    const parentVersionId = randomUUID();
    const childPageId = randomUUID();
    const childVersionId = randomUUID();
    const privateAssetId = randomUUID();
    const publishedAssetId = randomUUID();
    await admin.query("BEGIN");
    try {
      const workDirectory = await admin.query<{ id: string }>(
        "SELECT id FROM knowledge_directories WHERE current_path='profile/work'",
      );
      await admin.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id)
         VALUES ($1,'profile/private-work',$2)`,
        [privatePageId, privateVersionId],
      );
      await admin.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,summary,body_markdown,commit_message,actor_kind,actor_subject
         ) VALUES ($1,$2,1,'profile/private-work','PRIVATE-CANARY title','A private work fixture.','PRIVATE-CANARY body','Create private page','dashboard','owner')`,
        [privateVersionId, privatePageId],
      );
      await admin.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id,published_version_id,public_path)
         VALUES ($1,'profile-home',$2,$2,'profile')`,
        [parentPageId, parentVersionId],
      );
      await admin.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,summary,body_markdown,commit_message,actor_kind,actor_subject
         ) VALUES ($1,$2,1,'profile-home','Profile','A public profile fixture.','Public parent','Create public parent','dashboard','owner')`,
        [parentVersionId, parentPageId],
      );
      await admin.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id,published_version_id,public_path)
         VALUES ($1,'profile/work/project',$2,$2,'profile/work/project')`,
        [childPageId, childVersionId],
      );
      await admin.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,summary,body_markdown,commit_message,actor_kind,actor_subject
         ) VALUES (
           $1,$2,1,'profile/work/project','Project','A public project fixture.',
           $3,'Create public child','dashboard','owner'
         )`,
        [
          childVersionId,
          childPageId,
          [
            "PUBLIC-CANARY content",
            `[Private label](context-use://page/${privatePageId})`,
            `[Public parent](context-use://page/${parentPageId})`,
            `[Work index](context-use://directory/${workDirectory.rows[0]!.id})`,
            "[[profile/work|Work wiki index]]",
            `![Private image](context-use://asset/${privateAssetId}){size=medium align=center shape=square}`,
            `![Public image](context-use://asset/${publishedAssetId}){size=medium align=center shape=square}`,
            "[[private/strategy]]",
            "[[private/strategy|Authored label]]",
            `context-use://page/${privatePageId}`,
            `/api/mcp/assets/${privateAssetId}/content`,
            `https://context.example/api/mcp/assets/${privateAssetId}/content`,
            `/api/dashboard/assets/${privateAssetId}/status`,
            `unrecognized-private-id:${privateVersionId}`,
            "<!-- COMMENT-CANARY -->",
            "<script>SCRIPT-CANARY</script>",
            "<style>STYLE-CANARY</style>",
            "<meta name=private content=ATTRIBUTE-CANARY>",
            "<span data-private=ATTRIBUTE-CANARY>Visible span text</span>",
            "<script>UNCLOSED-SCRIPT-CANARY",
          ].join("\n\n"),
        ],
      );
      await admin.query(
        `INSERT INTO assets(
           id,current_path,public_path,filename,content_type,size_bytes,
           content_hash,s3_object_key
         ) VALUES (
           $1,'media/public-image','media/public-image','public.png','image/png',1,
           $2,$3
         )`,
        [publishedAssetId, "a".repeat(64), `objects/${publishedAssetId}`],
      );

      await admin.query("SET LOCAL ROLE context_use_public");
      const webpage = await admin.query<{
        public_path: string;
        title: string;
        summary: string;
        body_markdown: string;
        last_edited_at: Date;
      }>(
        "SELECT public_path,title,summary,body_markdown,last_edited_at FROM published_pages WHERE public_path='profile/work/project'",
      );
      const directProjection = await admin.query<{ body_markdown: string }>(
        "SELECT project_public_markdown('profile/work/project') AS body_markdown",
      );
      const unavailableProjection = await admin.query<{ body_markdown: string }>(
        "SELECT project_public_markdown('profile/work') AS body_markdown",
      );
      const publicKnowledge = new PublicRepository(admin as unknown as Pool);
      const rootIndex = await publicKnowledge.directoryIndex("");
      const workIndex = await publicKnowledge.directoryIndex("profile/work");
      const missingIndex = await publicKnowledge.directoryIndex("profile/private");
      await admin.query("RESET ROLE");
      expect(Object.keys(webpage.rows[0]!).sort()).toEqual(["body_markdown", "last_edited_at", "public_path", "summary", "title"]);
      expect(webpage.rows[0]?.last_edited_at).toBeInstanceOf(Date);
      expect(webpage.rows[0]?.summary).toBe("A public project fixture.");
      expect(webpage.rows[0]?.body_markdown).toContain("[Public parent](/p/profile)");
      expect(webpage.rows[0]?.body_markdown).toContain("[Work index](/i/profile/work)");
      expect(webpage.rows[0]?.body_markdown).toContain("[Work wiki index](/i/profile/work)");
      expect(webpage.rows[0]?.body_markdown).toContain("context-use://public-asset/media/public-image");
      expect(webpage.rows[0]?.body_markdown).not.toContain(privatePageId);
      expect(webpage.rows[0]?.body_markdown).not.toContain(privateAssetId);
      expect(webpage.rows[0]?.body_markdown).not.toContain(publishedAssetId);
      expect(webpage.rows[0]?.body_markdown).not.toContain(privateVersionId);
      expect(webpage.rows[0]?.body_markdown).not.toContain("/api/mcp/assets/");
      expect(webpage.rows[0]?.body_markdown).not.toContain("/api/dashboard/assets/");
      expect(directProjection.rows[0]?.body_markdown).toBe(webpage.rows[0]?.body_markdown);
      expect(unavailableProjection.rows[0]?.body_markdown).toBe("");
      expect(rootIndex?.entries).toContainEqual({
        kind: "directory",
        path: "profile",
        title: null,
        summary: null,
        published_count: 1,
      });
      expect(workIndex?.entries).toEqual([{
        kind: "page",
        path: "profile/work/project",
        title: "Project",
        summary: "A public project fixture.",
        published_count: 1,
      }]);
      expect(missingIndex).toBeNull();
    } finally {
      await admin.query("ROLLBACK");
    }
  });

  test("publication procedure is the only successful private-to-public transition", async () => {
    const pageId = randomUUID();
    const versionId = randomUUID();
    const intentId = randomUUID();
    const mismatchedIntentId = randomUUID();
    await admin.query("BEGIN");
    try {
      await ensureOwnerPasskey();
      await admin.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id) VALUES ($1,'test/security-boundary',$2)`,
        [pageId, versionId],
      );
      await admin.query(
        `INSERT INTO knowledge_page_versions(id,page_id,version_number,path,title,summary,body_markdown,commit_message,actor_kind,actor_subject)
         VALUES ($1,$2,1,'test/security-boundary','Boundary','A publication boundary fixture.','Private body','Create fixture','dashboard','test-owner')`,
        [versionId, pageId],
      );
      await admin.query(
        `INSERT INTO publication_intents(id,action,target_kind,target_id,version_id,public_path,owner_user_id,session_id,expires_at)
         VALUES ($1,'publish','page',$2,$3,'test/security-boundary','context-use-owner','session',now()+interval '5 minutes')`,
        [intentId, pageId, versionId],
      );
      await admin.query(
        `INSERT INTO publication_intents(id,action,target_kind,target_id,version_id,public_path,owner_user_id,session_id,expires_at)
         VALUES ($1,'publish','page',$2,$3,'test/forged-path','context-use-owner','session',now()+interval '5 minutes')`,
        [mismatchedIntentId, pageId, versionId],
      );

      for (const role of ["context_use_dashboard", "context_use_mcp"]) {
        await admin.query(`SET LOCAL ROLE ${role}`);
        await expectDenied("UPDATE knowledge_pages SET public_path='bypass' WHERE id=$1", [pageId]);
        await admin.query("RESET ROLE");
      }

      await issueChallenge("publication", intentId);
      await issueChallenge("publication", mismatchedIntentId);
      await admin.query("SET LOCAL ROLE context_use_confirmation");
      await expectDenied(
        "SELECT confirm_publication_intent($1,NULL,'session','test-credential',0,1)",
        [intentId],
      );
      await expectDenied(
        "SELECT confirm_publication_intent($1,'context-use-owner',NULL,'test-credential',0,1)",
        [intentId],
      );
      await expectDenied(
        "SELECT confirm_publication_intent($1,'context-use-owner','session',NULL,0,1)",
        [intentId],
      );
      await expectDenied(
        "SELECT confirm_publication_intent($1,'context-use-owner','session','test-credential',0,1)",
        [mismatchedIntentId],
      );
      await admin.query("SELECT confirm_publication_intent($1,'context-use-owner','session','test-credential',0,1)", [intentId]);
      await expectDenied("UPDATE knowledge_pages SET current_path='confirmation-cannot-edit' WHERE id=$1", [pageId]);
      await admin.query("RESET ROLE");

      const published = await admin.query("SELECT 1 FROM published_page_sources WHERE id=$1 AND published_version_id=$2", [pageId, versionId]);
      expect(published.rowCount).toBe(1);
      await expect(admin.query("SELECT confirm_publication_intent($1,'context-use-owner','session','test-credential',1,2)", [intentId])).rejects.toThrow();
    } finally {
      await admin.query("ROLLBACK");
    }
  });
});
