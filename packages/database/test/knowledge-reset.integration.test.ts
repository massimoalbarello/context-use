import { afterAll, describe, expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client, type Pool } from "pg";
import {
  KnowledgeArchiveRepository,
  KnowledgeResetRepository,
  type KnowledgeTemplateBaseline,
} from "../src/index.ts";
import { disposableDatabaseUrl } from "../src/disposable-database.ts";
import { MemoryMarkdownStore } from "./memory-markdown-store.ts";

const databaseUrl = await disposableDatabaseUrl();
const describeDatabase = databaseUrl ? describe : describe.skip;

const baseline: KnowledgeTemplateBaseline = {
  template: "default",
  root_directory: { title: "Knowledge", summary: "The root of the owner's knowledge base." },
  root_guide: {
    title: "AGENTS.md",
    summary: "The global instructions for maintaining this knowledge base.",
    body_markdown: "# Knowledge base structure\n",
    commit_message: "Apply default knowledge template",
    actor_subject: "context-use-template/default",
  },
};

async function failure(client: Client, run: () => Promise<unknown>): Promise<string | undefined> {
  await client.query("SAVEPOINT guard");
  try {
    await run();
    await client.query("RELEASE SAVEPOINT guard");
    return undefined;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT guard");
    await client.query("RELEASE SAVEPOINT guard");
    return (error as { code?: string }).code;
  }
}

describeDatabase("passkey-confirmed knowledge base reset", () => {
  const client = new Client({ connectionString: databaseUrl });
  const bodies = new MemoryMarkdownStore();

  afterAll(async () => {
    await client.end().catch(() => undefined);
  });

  test("clears every knowledge row behind the archive gate and leaves an importable template", async () => {
    await client.connect();
    await client.query("BEGIN");
    try {
      const resets = new KnowledgeResetRepository(client as unknown as Pool, bodies);
      const archives = new KnowledgeArchiveRepository(client as unknown as Pool, bodies);
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      await client.query("SET LOCAL session_replication_role=replica");
      await client.query(
        `TRUNCATE TABLE confirmation_challenges,publication_intents,knowledge_export_intents,
           knowledge_import_intents,page_deletion_intents,published_page_artifacts,
           public_projection_state,public_knowledge_settings,source_records,
           hypermedia_document_revisions,hypermedia_documents,knowledge_asset_links,
           knowledge_page_changes,knowledge_page_versions,knowledge_pages,assets,
           knowledge_directories RESTART IDENTITY`,
      );
      await client.query("INSERT INTO public_projection_state(singleton) VALUES (true)");
      await client.query("INSERT INTO public_knowledge_settings(singleton) VALUES (true)");
      await client.query("SET LOCAL session_replication_role=origin");

      const rootId = randomUUID();
      const guidePageId = randomUUID();
      const guideVersionId = randomUUID();
      await client.query(
        `INSERT INTO knowledge_directories(id,current_path,title,summary,search_vector)
         VALUES ($1,'','Knowledge','Local root.',directory_search_vector('','Knowledge','Local root.',''))`,
        [rootId],
      );
      await client.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id,search_vector)
         VALUES ($1,'agents',$2,page_search_vector('agents','AGENTS.md','Local root guide.','Local'))`,
        [guidePageId, guideVersionId],
      );
      await client.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,summary,body_markdown,commit_message,actor_kind,actor_subject
         ) VALUES ($1,$2,1,'agents','AGENTS.md','Local root guide.','Local','Rewrite the root guide','dashboard','context-use-owner')`,
        [guideVersionId, guidePageId],
      );

      await client.query(
        `INSERT INTO knowledge_directories(id,current_path,title,summary,search_vector)
         VALUES ($1,'people','People','Local people.',directory_search_vector('people','People','Local people.',''))`,
        [randomUUID()],
      );
      const publishedPageId = randomUUID();
      const publishedVersionId = randomUUID();
      await client.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id,published_version_id,public_path,search_vector)
         VALUES ($1,'people/ada',$2,$2,'people/ada',page_search_vector('people/ada','Ada','A published person.','Body'))`,
        [publishedPageId, publishedVersionId],
      );
      await client.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,summary,body_markdown,commit_message,actor_kind,actor_subject
         ) VALUES ($1,$2,1,'people/ada','Ada','A published person.','Body','Create Ada','mcp','local-agent')`,
        [publishedVersionId, publishedPageId],
      );
      const archivedPageId = randomUUID();
      const archivedVersionId = randomUUID();
      await client.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id,archived_at,search_vector)
         VALUES ($1,'people/retired',$2,now(),page_search_vector('people/retired','Retired','An archived person.','Body'))`,
        [archivedPageId, archivedVersionId],
      );
      await client.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,summary,body_markdown,commit_message,actor_kind,actor_subject
         ) VALUES ($1,$2,1,'people/retired','Retired','An archived person.','Body','Archive Retired','dashboard','context-use-owner')`,
        [archivedVersionId, archivedPageId],
      );
      const assetId = randomUUID();
      await client.query(
        `INSERT INTO assets(
           id,current_path,public_path,filename,content_type,size_bytes,content_hash,s3_object_key
         ) VALUES ($1,'people/ada-portrait','people/ada-portrait','ada.png','image/png',9,$2,$3)`,
        [assetId, "c".repeat(64), `objects/${assetId}`],
      );
      await client.query(
        "INSERT INTO knowledge_asset_links(source_version_id,target_asset_id) VALUES ($1,$2)",
        [publishedVersionId, assetId],
      );

      expect(await resets.summary()).toEqual({
        page_count: 2,
        archived_page_count: 1,
        directory_count: 2,
        asset_count: 1,
        published_page_count: 1,
        published_asset_count: 1,
      });
      expect(await resets.assetObjectKeys()).toEqual([`objects/${assetId}`]);
      expect(await archives.importAvailable()).toBe(false);

      await client.query(
        `INSERT INTO "user"(id,name,email,"emailVerified")
         VALUES ('context-use-owner','Owner','owner@example.invalid',true)
         ON CONFLICT (id) DO NOTHING`,
      );
      const credentialId = `reset-${randomUUID()}`;
      await client.query(
        `INSERT INTO passkey(
           id,name,"publicKey","userId","credentialID",counter,"deviceType","backedUp",transports,"createdAt",aaguid
         ) VALUES ($1,'Reset test','test-key','context-use-owner',$2,0,'singleDevice',false,'internal',now(),'test')`,
        [`reset-${randomUUID()}`, credentialId],
      );

      // A reset can never ride on the portable snapshot, which cannot restore.
      expect(await failure(client, () => client.query(
        `INSERT INTO knowledge_export_intents(
           id,owner_user_id,session_id,export_kind,reset_requested,expires_at
         ) VALUES ($1,'context-use-owner','reset-session','portable',true,now()+interval '5 minutes')`,
        [randomUUID()],
      ))).toBe("23514");

      const intentId = randomUUID();
      await client.query(
        `INSERT INTO knowledge_export_intents(
           id,owner_user_id,session_id,export_kind,reset_requested,expires_at
         ) VALUES ($1,'context-use-owner','reset-session','restorable',true,now()+interval '5 minutes')`,
        [intentId],
      );

      const clear = () => resets.clear(intentId, {
        ownerUserId: "context-use-owner",
        sessionId: "reset-session",
      }, baseline);

      await client.query("SET LOCAL ROLE context_use_dashboard");
      expect(await failure(client, clear)).toBe("42501");
      await client.query("RESET ROLE");

      await client.query("SET LOCAL ROLE context_use_confirmation");
      await client.query("SELECT issue_confirmation_challenge('knowledge_export',$1,$2)", [
        intentId,
        randomBytes(32).toString("base64url"),
      ]);
      await client.query(
        "SELECT confirm_knowledge_export_intent($1,'context-use-owner','reset-session',$2,0,0)",
        [intentId, credentialId],
      );
      await client.query("RESET ROLE");

      // Confirmation alone is not enough: the archive still has to reach the owner.
      await client.query("SET LOCAL ROLE context_use_dashboard");
      expect(await failure(client, clear)).toBe("55000");
      await client.query("RESET ROLE");

      await client.query("SET LOCAL ROLE context_use_confirmation");
      expect(await failure(client, () => client.query(
        "SELECT complete_knowledge_export_download($1,'context-use-owner','reset-session')",
        [intentId],
      ))).toBe("42501");
      await client.query("SELECT claim_knowledge_export_download($1,'context-use-owner','reset-session')", [intentId]);
      await client.query(
        "SELECT complete_knowledge_export_download($1,'context-use-owner','reset-session')",
        [intentId],
      );
      await client.query("RESET ROLE");

      await client.query("SET LOCAL ROLE context_use_dashboard");
      expect(await failure(client, () => resets.clear(intentId, {
        ownerUserId: "context-use-owner",
        sessionId: "another-session",
      }, baseline))).toBe("42501");
      expect(await failure(client, () => resets.clear(intentId, {
        ownerUserId: "context-use-owner",
        sessionId: "reset-session",
      }, { ...baseline, root_guide: { ...baseline.root_guide, actor_subject: "context-use-owner" } }))).toBe("22023");

      const cleared = await clear();
      await client.query("RESET ROLE");

      expect(cleared).toEqual({
        directories: 2,
        pages: 3,
        page_versions: 3,
        assets: 1,
        asset_links: 1,
        page_changes: 3,
      });
      expect((await client.query("SELECT current_path,title,summary,version_number FROM knowledge_directories")).rows).toEqual([{
        current_path: "",
        title: baseline.root_directory.title,
        summary: baseline.root_directory.summary,
        version_number: 1,
      }]);
      const guide = await client.query<{
        id: string;
        current_path: string;
        published_version_id: string | null;
        public_path: string | null;
        archived_at: Date | null;
      }>("SELECT id,current_path,published_version_id,public_path,archived_at FROM knowledge_pages");
      expect(guide.rows).toEqual([{
        id: guidePageId,
        current_path: "agents",
        published_version_id: null,
        public_path: null,
        archived_at: null,
      }]);
      const versions = await client.query<{ version_number: number; body_markdown: null; actor_subject: string }>(
        "SELECT version_number,body_markdown,actor_subject FROM knowledge_page_versions",
      );
      expect(versions.rows).toEqual([{
        version_number: 1,
        body_markdown: null,
        actor_subject: baseline.root_guide.actor_subject,
      }]);
      expect((await client.query("SELECT count(*)::int AS total FROM assets")).rows[0]?.total).toBe(0);
      expect((await client.query("SELECT count(*)::int AS total FROM knowledge_asset_links")).rows[0]?.total).toBe(0);
      expect((await client.query(
        "SELECT change_sequence::text,change_kind,path,actor_subject FROM knowledge_page_changes change ORDER BY change.change_sequence",
      )).rows).toEqual([{
        change_sequence: "1",
        change_kind: "created",
        path: "agents",
        actor_subject: baseline.root_guide.actor_subject,
      }]);
      expect((await client.query("SELECT nextval('knowledge_page_changes_change_sequence_seq')::text AS value")).rows[0]?.value).toBe("2");
      expect((await client.query(
        "SELECT reset_completed_at IS NOT NULL AS done FROM knowledge_export_intents WHERE id=$1",
        [intentId],
      )).rows[0]?.done).toBeTrue();

      // A cleared instance is exactly what the full-archive import requires.
      expect(await archives.importAvailable()).toBe(true);

      await client.query("SET LOCAL ROLE context_use_dashboard");
      expect(await failure(client, clear)).toBe("23505");
      await client.query("RESET ROLE");
    } finally {
      await client.query("ROLLBACK");
    }
  });

  test("refuses an export intent that was never authorized to clear knowledge", async () => {
    const plain = new Client({ connectionString: databaseUrl });
    await plain.connect();
    await plain.query("BEGIN");
    try {
      const resets = new KnowledgeResetRepository(plain as unknown as Pool, bodies);
      const intentId = randomUUID();
      await plain.query(
        `INSERT INTO knowledge_export_intents(
           id,owner_user_id,session_id,export_kind,expires_at
         ) VALUES ($1,'context-use-owner','plain-session','restorable',now()+interval '5 minutes')`,
        [intentId],
      );
      await plain.query("SET LOCAL ROLE context_use_dashboard");
      expect(await failure(plain, () => resets.clear(intentId, {
        ownerUserId: "context-use-owner",
        sessionId: "plain-session",
      }, baseline))).toBe("42501");
      await plain.query("RESET ROLE");
    } finally {
      await plain.query("ROLLBACK");
      await plain.end().catch(() => undefined);
    }
  });
});
