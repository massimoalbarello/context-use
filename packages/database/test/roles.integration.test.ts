import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client, type Pool } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { InboxRepository, PublicMcpRepository, PublicMessageRepository, PublicRepository } from "../src/index.ts";

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
    kind: "publication" | "knowledge_export",
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

  test("only confirmation role can issue challenges and execute visibility procedures", async () => {
    const functions = [
      "issue_confirmation_challenge(confirmation_intent_kind,uuid,text)",
      "confirm_publication_intent(uuid,text,text,text,integer,integer)",
    ];
    for (const role of ["context_use_mcp", "context_use_dashboard", "context_use_public", "context_use_public_mcp", "context_use_auth"]) {
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

  test("only the passkey-confirmation role can authorize or claim a knowledge export", async () => {
    const functions = [
      "confirm_knowledge_export_intent(uuid,text,text,text,integer,integer)",
      "claim_knowledge_export_download(uuid,text,text)",
    ];
    for (const fn of functions) {
      for (const role of ["context_use_auth", "context_use_dashboard", "context_use_mcp", "context_use_public", "context_use_public_mcp", "context_use_backup"]) {
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
    for (const column of ["confirmed_at", "credential_id", "download_started_at"]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_column_privilege('context_use_dashboard','knowledge_export_intents',$1,'INSERT') AS allowed",
        [column],
      )).rows[0]?.allowed).toBe(false);
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_column_privilege('context_use_dashboard','knowledge_export_intents',$1,'UPDATE') AS allowed",
        [column],
      )).rows[0]?.allowed).toBe(false);
    }
    for (const table of ["knowledge_export_intents", "knowledge_export_pages", "knowledge_export_assets"]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_table_privilege('context_use_confirmation',$1,'SELECT') AS allowed",
        [table],
      )).rows[0]?.allowed).toBe(false);
      for (const role of ["context_use_auth", "context_use_mcp", "context_use_public", "context_use_public_mcp"]) {
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
      "context_use_public_mcp",
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
           'storage_published_assets','public_mcp_pages'
         )
       ORDER BY relname`,
    );
    expect(views.rows).toEqual([
      { relname: "public_mcp_pages", owner: "context_use_projection_owner" },
      { relname: "published_assets", owner: "context_use_projection_owner" },
      { relname: "published_page_sources", owner: "context_use_projection_owner" },
      { relname: "published_pages", owner: "context_use_projection_owner" },
      { relname: "storage_published_assets", owner: "context_use_projection_owner" },
    ]);

    for (const [role, procedure, allowed] of [
      ["context_use_public", "project_public_markdown(text)", true],
      ["context_use_public", "project_public_mcp_markdown(text)", false],
      ["context_use_public_mcp", "project_public_markdown(text)", false],
      ["context_use_public_mcp", "project_public_mcp_markdown(text)", true],
    ] as const) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",
        [role, procedure],
      )).rows[0]?.allowed).toBe(allowed);
    }
    for (const role of ["context_use_auth", "context_use_dashboard", "context_use_mcp", "context_use_confirmation", "context_use_storage", "context_use_backup"]) {
      for (const procedure of ["project_public_markdown(text)", "project_public_mcp_markdown(text)"]) {
        expect((await admin.query<{ allowed: boolean }>(
          "SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",
          [role, procedure],
        )).rows[0]?.allowed).toBe(false);
      }
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
           'claim_knowledge_export_download',
           'project_public_markdown',
           'project_public_mcp_markdown'
         )
       ORDER BY proname`,
    );
    expect(procedures.rows).toEqual([
      { proname: "claim_knowledge_export_download", owner: "context_use_boundary_owner", security_definer: true },
      { proname: "confirm_knowledge_export_intent", owner: "context_use_boundary_owner", security_definer: true },
      { proname: "confirm_publication_intent", owner: "context_use_boundary_owner", security_definer: true },
      { proname: "consume_confirmation_challenge", owner: "context_use_boundary_owner", security_definer: true },
      { proname: "issue_confirmation_challenge", owner: "context_use_boundary_owner", security_definer: true },
      { proname: "project_public_markdown", owner: "context_use_projection_owner", security_definer: true },
      { proname: "project_public_mcp_markdown", owner: "context_use_projection_owner", security_definer: true },
    ]);

    for (const [relation, column] of [
      ["knowledge_page_versions", "body_markdown"],
      ["knowledge_page_versions", "title"],
      ["assets", "s3_object_key"],
      ["knowledge_export_pages", "version_id"],
      ["knowledge_export_assets", "s3_object_key"],
    ]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_column_privilege('context_use_boundary_owner',$1,$2,'SELECT') AS allowed",
        [relation, column],
      )).rows[0]?.allowed).toBe(false);
    }
    for (const [relation, column] of [
      ["publication_intents", "challenge"],
      ["knowledge_page_versions", "path"],
      ["knowledge_pages", "required_public_path"],
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
           id,owner_user_id,session_id,challenge,expires_at
         ) VALUES ($1,'not-the-owner','session',$2,now()+interval '5 minutes')`,
        [randomUUID(), `wrong-owner-${randomUUID()}`],
      );
      await expectDenied(
        `INSERT INTO knowledge_export_intents(
           id,owner_user_id,session_id,challenge,expires_at
         ) VALUES ($1,'context-use-owner','session',$2,now()+interval '5 minutes 1 second')`,
        [randomUUID(), `long-lived-${randomUUID()}`],
      );
    } finally {
      await admin.query("ROLLBACK");
    }
  });

  test("the required public about page exists and cannot be moved or unpublished", async () => {
    const required = await admin.query<{
      id: string;
      current_path: string;
      current_version_id: string;
      published_version_id: string;
      public_path: string;
      required_public_path: string;
    }>(
      `SELECT id,current_path,current_version_id,published_version_id,public_path,required_public_path
       FROM knowledge_pages WHERE required_public_path='about'`,
    );
    expect(required.rowCount).toBe(1);
    expect(required.rows[0]).toMatchObject({
      current_path: "about/intro",
      public_path: "about",
      required_public_path: "about",
    });
    expect((await admin.query("SELECT 1 FROM published_page_sources WHERE public_path='about' AND path='about/intro'")).rowCount).toBe(1);
    expect((await admin.query(
      `SELECT 1
       FROM knowledge_pages page
       JOIN knowledge_page_versions version ON version.id=page.current_version_id
       WHERE page.current_path='agents' AND page.archived_at IS NULL
         AND version.title='AGENTS.md' AND version.body_markdown LIKE '%about/intro%'`,
    )).rowCount).toBe(1);

    await admin.query("BEGIN");
    try {
      await ensureOwnerPasskey();
      const page = required.rows[0]!;
      await expectDenied(
        `INSERT INTO publication_intents(
           id,action,target_kind,target_id,owner_user_id,session_id,
           payload_hash,expires_at
         ) VALUES ($1,'unpublish','page',$2,'context-use-owner','session',$3,now()+interval '5 minutes')`,
        [randomUUID(), page.id, "a".repeat(64)],
      );
      await expectDenied(
        `INSERT INTO publication_intents(
           id,action,target_kind,target_id,version_id,public_path,owner_user_id,
           session_id,payload_hash,expires_at
         ) VALUES ($1,'republish','page',$2,$3,'moved-about','context-use-owner','session',$4,now()+interval '5 minutes')`,
        [randomUUID(), page.id, page.current_version_id, "b".repeat(64)],
      );
      await expectDenied(
        "UPDATE knowledge_pages SET current_path='about' WHERE id=$1",
        [page.id],
      );

      const republishIntent = randomUUID();
      await admin.query(
        `INSERT INTO publication_intents(
           id,action,target_kind,target_id,version_id,public_path,owner_user_id,
           session_id,payload_hash,expires_at
         ) VALUES ($1,'republish','page',$2,$3,'about','context-use-owner','session',$4,now()+interval '5 minutes')`,
        [republishIntent, page.id, page.current_version_id, "c".repeat(64)],
      );
      await issueChallenge("publication", republishIntent);
      await admin.query(
        "SELECT confirm_publication_intent($1,'context-use-owner','session','test-credential',0,1)",
        [republishIntent],
      );
      expect((await admin.query(
        "SELECT 1 FROM published_page_sources WHERE public_path='about' AND path='about/intro'",
      )).rowCount).toBe(1);
    } finally {
      await admin.query("ROLLBACK");
    }
  });

  test("public role can see publication views but not private base tables", async () => {
    for (const relation of ["knowledge_pages", "assets"]) {
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
      "public_path", "title", "body_markdown",
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
    for (const relation of ["knowledge_pages", "knowledge_page_versions", "inbound_messages"]) {
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
           payload_hash,expires_at
         ) VALUES ($1,'publish','asset',$2,$3,'context-use-owner','session',$4,now()+interval '5 minutes')`,
        [intentId, publishedAssetId, publishedPath, "a".repeat(64)],
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
        `INSERT INTO knowledge_pages(id,current_path,current_version_id,published_version_id,public_path)
         VALUES ($1,$2,$3,$3,$2)`,
        [pageId, `tests/${suffix}/published-page`, versionId],
      );
      await admin.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,body_markdown,commit_message,actor_kind,actor_subject
         ) VALUES ($1,$2,1,$3,'Published lifecycle','Public','Create','dashboard','owner')`,
        [versionId, pageId, `tests/${suffix}/published-page`],
      );
      await admin.query(
        `INSERT INTO assets(
           id,current_path,public_path,filename,content_type,size_bytes,
           content_hash,s3_object_key,published_at
         ) VALUES ($1,$2,$2,'published.txt','text/plain',1,$3,$4,now())`,
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
        "UPDATE assets SET published_at=NULL,public_path=NULL WHERE id=$1",
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
    for (const role of ["context_use_auth", "context_use_dashboard", "context_use_mcp", "context_use_public", "context_use_confirmation", "context_use_backup"]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT pg_has_role('context_use_public_mcp',$1,'MEMBER') AS allowed",
        [role],
      )).rows[0]?.allowed).toBe(false);
    }
    for (const relation of [
      "knowledge_pages", "knowledge_page_versions", "assets",
      "published_page_sources", "published_pages", "published_assets", "storage_published_assets",
    ]) {
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
      "public_path", "title", "body_markdown", "parent_path",
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
      for (const role of ["context_use_auth", "context_use_mcp", "context_use_public", "context_use_confirmation"]) {
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

  test("automation roles allow independent skill and automation creation without definition updates", async () => {
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','agent_skills','name','INSERT') AS allowed",
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','agent_skill_versions','instructions_markdown','INSERT') AS allowed",
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','agent_skill_versions','description','INSERT') AS allowed",
    )).rows[0]?.allowed).toBe(true);
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
      "SELECT has_column_privilege('context_use_mcp','cron_schedules','automation_key','UPDATE') AS allowed",
    )).rows[0]?.allowed).toBe(false);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','cron_schedules','cron_expression','UPDATE') AS allowed",
    )).rows[0]?.allowed).toBe(false);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','agent_skills','name','UPDATE') AS allowed",
    )).rows[0]?.allowed).toBe(false);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_mcp','agent_skills','deleted_at','UPDATE') AS allowed",
    )).rows[0]?.allowed).toBe(false);
    expect((await admin.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('context_use_dashboard','agent_skills','deleted_at','UPDATE') AS allowed",
    )).rows[0]?.allowed).toBe(true);
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
      "SELECT has_column_privilege('context_use_mcp','knowledge_pages','automation_id','UPDATE') AS allowed",
    )).rows[0]?.allowed).toBe(false);
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
           id,page_id,version_number,path,title,body_markdown,commit_message,actor_kind,actor_subject
         ) VALUES (
           $1,$2,1,'test/challenge-isolation','Challenge isolation','Private',
           'Create fixture','dashboard','owner'
         )`,
        [versionId, pageId],
      );
      await admin.query(
        `INSERT INTO publication_intents(
           id,action,target_kind,target_id,version_id,public_path,owner_user_id,
           session_id,payload_hash,expires_at
         ) VALUES (
           $1,'publish','page',$2,$3,'test/challenge-isolation',
           'context-use-owner','session',$4,now()+interval '5 minutes'
         )`,
        [sharedId, pageId, versionId, "a".repeat(64)],
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
        "UPDATE publication_intents SET challenge=$2 WHERE id=$1",
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
        `SELECT intent_kind,consumed_at IS NOT NULL AS consumed
         FROM confirmation_challenges WHERE intent_id=$1 ORDER BY intent_kind`,
        [sharedId],
      )).rows).toEqual([
        { intent_kind: "publication", consumed: true },
        { intent_kind: "knowledge_export", consumed: true },
      ]);
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
    const privateAssetId = randomUUID();
    const publishedAssetId = randomUUID();
    await admin.query("BEGIN");
    try {
      await admin.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id)
         VALUES ($1,'profile/work',$2)`,
        [privatePageId, privateVersionId],
      );
      await admin.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,body_markdown,commit_message,actor_kind,actor_subject
         ) VALUES ($1,$2,1,'profile/work','PRIVATE-CANARY title','PRIVATE-CANARY body','Create private page','dashboard','owner')`,
        [privateVersionId, privatePageId],
      );
      await admin.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id,published_version_id,public_path)
         VALUES ($1,'profile',$2,$2,'profile')`,
        [parentPageId, parentVersionId],
      );
      await admin.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,body_markdown,commit_message,actor_kind,actor_subject
         ) VALUES ($1,$2,1,'profile','Profile','Public parent','Create public parent','dashboard','owner')`,
        [parentVersionId, parentPageId],
      );
      await admin.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id,published_version_id,public_path)
         VALUES ($1,'profile/work/project',$2,$2,'profile/work/project')`,
        [childPageId, childVersionId],
      );
      await admin.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,body_markdown,commit_message,actor_kind,actor_subject
         ) VALUES (
           $1,$2,1,'profile/work/project','Project',
           $3,'Create public child','dashboard','owner'
         )`,
        [
          childVersionId,
          childPageId,
          [
            "PUBLIC-CANARY content",
            `[Private label](context-use://page/${privatePageId})`,
            `[Public parent](context-use://page/${parentPageId})`,
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
           content_hash,s3_object_key,published_at
         ) VALUES (
           $1,'media/public-image','media/public-image','public.png','image/png',1,
           $2,$3,now()
         )`,
        [publishedAssetId, "a".repeat(64), `objects/${publishedAssetId}`],
      );

      await admin.query("SET LOCAL ROLE context_use_public");
      const webpage = await admin.query<{
        public_path: string;
        title: string;
        body_markdown: string;
      }>(
        "SELECT public_path,title,body_markdown FROM published_pages WHERE public_path='profile/work/project'",
      );
      const directProjection = await admin.query<{ body_markdown: string }>(
        "SELECT project_public_markdown('profile/work/project') AS body_markdown",
      );
      const unavailableProjection = await admin.query<{ body_markdown: string }>(
        "SELECT project_public_markdown('profile/work') AS body_markdown",
      );
      await admin.query("RESET ROLE");
      expect(Object.keys(webpage.rows[0]!).sort()).toEqual(["body_markdown", "public_path", "title"]);
      expect(webpage.rows[0]?.body_markdown).toContain("[Public parent](/p/profile)");
      expect(webpage.rows[0]?.body_markdown).toContain("context-use://public-asset/media/public-image");
      expect(webpage.rows[0]?.body_markdown).not.toContain(privatePageId);
      expect(webpage.rows[0]?.body_markdown).not.toContain(privateAssetId);
      expect(webpage.rows[0]?.body_markdown).not.toContain(publishedAssetId);
      expect(webpage.rows[0]?.body_markdown).not.toContain(privateVersionId);
      expect(webpage.rows[0]?.body_markdown).not.toContain("/api/mcp/assets/");
      expect(webpage.rows[0]?.body_markdown).not.toContain("/api/dashboard/assets/");
      expect(directProjection.rows[0]?.body_markdown).toBe(webpage.rows[0]?.body_markdown);
      expect(unavailableProjection.rows[0]?.body_markdown).toBe("");

      await admin.query("SET LOCAL ROLE context_use_public_mcp");
      const repository = new PublicMcpRepository(admin as unknown as Pool);
      const projected = await admin.query<{
        public_path: string;
        title: string;
        body_markdown: string;
        parent_path: string | null;
      }>("SELECT public_path,title,body_markdown,parent_path FROM public_mcp_pages ORDER BY public_path");
      const directMcpProjection = await admin.query<{ body_markdown: string }>(
        "SELECT project_public_mcp_markdown('profile/work/project') AS body_markdown",
      );
      await expectDenied("SELECT project_public_markdown('profile/work/project')");
      expect((await repository.listPages()).map(({ path }) => path)).toEqual(["about", "profile", "profile/work/project"]);
      expect(await repository.getPage("profile/work/project")).toMatchObject({ path: "profile/work/project", parent_path: "profile" });
      expect(await repository.getPage("profile/work")).toBeNull();
      expect((await repository.searchPages("content", 10)).map(({ path }) => path)).toEqual(["profile/work/project"]);
      await expectDenied("SELECT * FROM published_pages");
      await admin.query("RESET ROLE");

      expect(projected.rows.map(({ public_path }) => public_path)).toEqual(["about", "profile", "profile/work/project"]);
      const child = projected.rows.find(({ public_path }) => public_path === "profile/work/project");
      expect(child).toMatchObject({ title: "Project", parent_path: "profile" });
      expect(directMcpProjection.rows[0]?.body_markdown).toBe(child?.body_markdown);
      expect(child?.body_markdown).toContain("PUBLIC-CANARY content");
      expect(child?.body_markdown).toContain("Private label");
      expect(child?.body_markdown).toContain("Authored label");
      expect(child?.body_markdown).not.toContain(privatePageId);
      expect(child?.body_markdown).not.toContain(privateAssetId);
      expect(child?.body_markdown).not.toContain(publishedAssetId);
      expect(child?.body_markdown).not.toContain(privateVersionId);
      expect(child?.body_markdown).not.toContain("/api/mcp/assets/");
      expect(child?.body_markdown).not.toContain("/api/dashboard/assets/");
      expect(child?.body_markdown).not.toContain("private/strategy");
      expect(child?.body_markdown).not.toContain("context-use://");
      expect(child?.body_markdown).not.toContain("{size=medium");
      expect(child?.body_markdown).not.toContain("COMMENT-CANARY");
      expect(child?.body_markdown).not.toContain("SCRIPT-CANARY");
      expect(child?.body_markdown).not.toContain("STYLE-CANARY");
      expect(child?.body_markdown).not.toContain("ATTRIBUTE-CANARY");
      expect(child?.body_markdown).toContain("Visible span text");
      expect(JSON.stringify(projected.rows)).not.toContain("PRIVATE-CANARY");
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
        `INSERT INTO knowledge_page_versions(id,page_id,version_number,path,title,body_markdown,commit_message,actor_kind,actor_subject)
         VALUES ($1,$2,1,'test/security-boundary','Boundary','Private body','Create fixture','dashboard','test-owner')`,
        [versionId, pageId],
      );
      await admin.query(
        `INSERT INTO publication_intents(id,action,target_kind,target_id,version_id,public_path,owner_user_id,session_id,payload_hash,expires_at)
         VALUES ($1,'publish','page',$2,$3,'test/security-boundary','context-use-owner','session',$4,now()+interval '5 minutes')`,
        [intentId, pageId, versionId, "a".repeat(64)],
      );
      await admin.query(
        `INSERT INTO publication_intents(id,action,target_kind,target_id,version_id,public_path,owner_user_id,session_id,payload_hash,expires_at)
         VALUES ($1,'publish','page',$2,$3,'test/forged-path','context-use-owner','session',$4,now()+interval '5 minutes')`,
        [mismatchedIntentId, pageId, versionId, "b".repeat(64)],
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
