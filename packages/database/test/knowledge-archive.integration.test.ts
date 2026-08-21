import { afterAll, describe, expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client, type Pool } from "pg";
import { KnowledgeArchiveRepository, type RestorableKnowledgeRecords } from "../src/index.ts";
import { disposableDatabaseUrl } from "../src/disposable-database.ts";
import { MemoryMarkdownStore } from "./memory-markdown-store.ts";

const databaseUrl = await disposableDatabaseUrl();
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("passkey-confirmed full knowledge restore", () => {
  const client = new Client({ connectionString: databaseUrl });
  const bodies = new MemoryMarkdownStore();

  afterAll(async () => {
    await client.end().catch(() => undefined);
  });

  test("restores IDs, retained versions, archived state, links, publication, and ledger exactly", async () => {
    await client.connect();
    await client.query("BEGIN");
    try {
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

      const destinationRootId = randomUUID();
      const destinationPageId = randomUUID();
      const destinationVersionId = randomUUID();
      await client.query(
        `INSERT INTO knowledge_directories(id,current_path,title,summary,search_vector)
         VALUES ($1,'','Knowledge','Fresh template root.',directory_search_vector('','Knowledge','Fresh template root.',''))`,
        [destinationRootId],
      );
      await client.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id,search_vector)
         VALUES ($1,'agents',$2,page_search_vector('agents','AGENTS.md','Fresh root guide.','Fresh'))`,
        [destinationPageId, destinationVersionId],
      );
      await client.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,summary,body_markdown,commit_message,actor_kind,actor_subject
         ) VALUES ($1,$2,1,'agents','AGENTS.md','Fresh root guide.','Fresh','Create template','dashboard','context-use-template/default')`,
        [destinationVersionId, destinationPageId],
      );
      const personalPageId = randomUUID();
      const personalVersionId = randomUUID();
      await client.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id,search_vector)
         VALUES ($1,'personal-before-import',$2,page_search_vector('personal-before-import','Personal','Personal destination knowledge.','Do not overwrite'))`,
        [personalPageId, personalVersionId],
      );
      await client.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,summary,body_markdown,commit_message,actor_kind,actor_subject
         ) VALUES ($1,$2,1,'personal-before-import','Personal','Personal destination knowledge.','Do not overwrite','Create personal page','dashboard','destination-owner')`,
        [personalVersionId, personalPageId],
      );
      expect(await archives.importAvailable()).toBe(false);

      await client.query(
        `INSERT INTO "user"(id,name,email,"emailVerified")
         VALUES ('context-use-owner','Owner','owner@example.invalid',true)
         ON CONFLICT (id) DO NOTHING`,
      );
      const credentialId = `archive-${randomUUID()}`;
      const passkeyId = `archive-${randomUUID()}`;
      await client.query(
        `INSERT INTO passkey(
           id,name,"publicKey","userId","credentialID",counter,"deviceType","backedUp",transports,"createdAt",aaguid
         ) VALUES ($1,'Archive test','test-key','context-use-owner',$2,0,'singleDevice',false,'internal',now(),'test')`,
        [passkeyId, credentialId],
      );

      const sourceRootId = randomUUID();
      const sourceAgentsId = randomUUID();
      const sourceAgentsV1 = randomUUID();
      const sourceAgentsV2 = randomUUID();
      const archivedPageId = randomUUID();
      const archivedVersionId = randomUUID();
      const activeAssetId = randomUUID();
      const deletedAssetId = randomUUID();
      const deletedTombstonePageId = randomUUID();
      const deletedTombstoneVersionId = randomUUID();
      const at = "2026-08-13 10:11:12.123456+00";
      const records: RestorableKnowledgeRecords = {
        public_settings: { entrypoint_page_id: sourceAgentsId },
        directories: [{
          id: sourceRootId,
          current_path: "",
          version_number: 4,
          title: "Original knowledge",
          summary: "The source installation root.",
          created_at: at,
          updated_at: at,
        }],
        pages: [{
          id: sourceAgentsId,
          current_path: "agents",
          current_version_id: sourceAgentsV2,
          published_version_id: sourceAgentsV1,
          public_path: "agents",
          created_at: at,
          updated_at: at,
          archived_at: null,
        }, {
          id: archivedPageId,
          current_path: "old-context",
          current_version_id: archivedVersionId,
          published_version_id: null,
          public_path: null,
          created_at: at,
          updated_at: at,
          archived_at: at,
        }],
        page_versions: [{
          id: sourceAgentsV1,
          page_id: sourceAgentsId,
          version_number: 1,
          path: "agents",
          title: "AGENTS.md",
          summary: "Original root guide.",
          body_markdown: "First source guide.",
          commit_message: "Create source guide",
          actor_kind: "dashboard",
          actor_subject: "source-owner",
          created_at: at,
        }, {
          id: sourceAgentsV2,
          page_id: sourceAgentsId,
          version_number: 2,
          path: "agents",
          title: "AGENTS.md",
          summary: "Original root guide.",
          body_markdown: `Current source guide with ![](context-use://asset/${activeAssetId}).`,
          commit_message: "Update source guide",
          actor_kind: "mcp",
          actor_subject: "source-agent",
          created_at: at,
        }, {
          id: archivedVersionId,
          page_id: archivedPageId,
          version_number: 1,
          path: "old-context",
          title: "Old context",
          summary: "Archived source context.",
          body_markdown: "Still retained.",
          commit_message: "Archive old context",
          actor_kind: "dashboard",
          actor_subject: "source-owner",
          created_at: at,
        }],
        assets: [{
          id: activeAssetId,
          current_path: "assets/source",
          public_path: "assets/source",
          filename: "source.txt",
          content_type: "text/plain",
          size_bytes: "12",
          content_hash: "a".repeat(64),
          s3_object_key: `objects/${activeAssetId}`,
          width: null,
          height: null,
          duration_seconds: null,
          created_at: at,
          deleted_at: null,
        }, {
          id: deletedAssetId,
          current_path: "assets/deleted",
          public_path: null,
          filename: "deleted.txt",
          content_type: "text/plain",
          size_bytes: "7",
          content_hash: "b".repeat(64),
          s3_object_key: `objects/${deletedAssetId}`,
          width: null,
          height: null,
          duration_seconds: null,
          created_at: at,
          deleted_at: at,
        }],
        asset_links: [{ source_version_id: sourceAgentsV2, target_asset_id: activeAssetId, created_at: at }],
        page_changes: [{
          change_sequence: "9",
          page_id: sourceAgentsId,
          version_id: sourceAgentsV2,
          version_number: 2,
          change_kind: "updated",
          path: "agents",
          title: "AGENTS.md",
          commit_message: "Update source guide",
          actor_kind: "mcp",
          actor_subject: "source-agent",
          changed_at: at,
        }, {
          change_sequence: "15",
          page_id: deletedTombstonePageId,
          version_id: deletedTombstoneVersionId,
          version_number: 3,
          change_kind: "deleted",
          path: "deleted-context",
          title: "Deleted context",
          commit_message: "Permanently delete page",
          actor_kind: null,
          actor_subject: null,
          changed_at: at,
        }],
      };
      const intentId = randomUUID();
      await client.query(
        `INSERT INTO knowledge_import_intents(
           id,owner_user_id,session_id,archive,archive_sha256,
           active_asset_count,total_asset_bytes,expires_at
         ) VALUES ($1,'context-use-owner','archive-session',$2::jsonb,$3,1,12,now()+interval '15 minutes')`,
        [intentId, JSON.stringify(records), "c".repeat(64)],
      );

      await client.query("SET LOCAL ROLE context_use_confirmation");
      await client.query("SELECT issue_confirmation_challenge('knowledge_import',$1,$2)", [
        intentId,
        randomBytes(32).toString("base64url"),
      ]);
      await client.query(
        "SELECT confirm_knowledge_import_intent($1,'context-use-owner','archive-session',$2,0,0)",
        [intentId, credentialId],
      );
      await client.query("RESET ROLE");
      const confirmedExpiry = await client.query<{ expires_at: Date }>(
        "SELECT expires_at FROM knowledge_import_intents WHERE id=$1",
        [intentId],
      );
      expect(confirmedExpiry.rows[0]!.expires_at.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1_000);

      await client.query("SET LOCAL ROLE context_use_dashboard");
      await client.query("SAVEPOINT fresh_instance_guard");
      let guardError: unknown;
      try {
        await client.query(
          "SELECT restore_knowledge_import($1,'context-use-owner','archive-session')",
          [intentId],
        );
      } catch (error) {
        guardError = error;
        await client.query("ROLLBACK TO SAVEPOINT fresh_instance_guard");
      }
      await client.query("RELEASE SAVEPOINT fresh_instance_guard");
      expect((guardError as { code?: string } | undefined)?.code).toBe("55000");
      await client.query("RESET ROLE");

      await client.query("SET LOCAL session_replication_role=replica");
      await client.query("DELETE FROM knowledge_page_versions WHERE id=$1", [personalVersionId]);
      await client.query("DELETE FROM knowledge_pages WHERE id=$1", [personalPageId]);
      await client.query("DELETE FROM knowledge_page_changes WHERE page_id=$1", [personalPageId]);
      await client.query("SET LOCAL session_replication_role=origin");
      expect(await archives.importAvailable()).toBe(true);

      await client.query("SET LOCAL ROLE context_use_dashboard");
      const restored = await archives.restoreImportIntent(intentId, {
        ownerUserId: "context-use-owner",
        sessionId: "archive-session",
      });
      await client.query("RESET ROLE");

      expect(restored).toEqual({
        directories: 1,
        pages: 2,
        page_versions: 3,
        assets: 2,
        asset_links: 1,
        page_changes: 2,
      });
      expect((await client.query("SELECT id,title,version_number FROM knowledge_directories WHERE current_path='' ")).rows[0]).toMatchObject({
        id: sourceRootId,
        title: "Original knowledge",
        version_number: 4,
      });
      expect((await client.query("SELECT id,current_version_id,published_version_id,public_path FROM knowledge_pages WHERE current_path='agents'")).rows[0]).toMatchObject({
        id: sourceAgentsId,
        current_version_id: sourceAgentsV2,
        published_version_id: sourceAgentsV1,
        public_path: "agents",
      });
      expect((await client.query(
        "SELECT entrypoint_page_id FROM public_knowledge_settings WHERE singleton",
      )).rows[0]?.entrypoint_page_id).toBe(sourceAgentsId);
      expect((await client.query("SELECT archived_at IS NOT NULL AS archived FROM knowledge_pages WHERE id=$1", [archivedPageId])).rows[0]?.archived).toBeTrue();
      expect((await client.query("SELECT id FROM knowledge_page_versions ORDER BY id")).rows.map(({ id }) => id).sort()).toEqual(
        [sourceAgentsV1, sourceAgentsV2, archivedVersionId].sort(),
      );
      expect((await client.query("SELECT source_version_id,target_asset_id FROM knowledge_asset_links")).rows[0]).toEqual({
        source_version_id: sourceAgentsV2,
        target_asset_id: activeAssetId,
      });
      expect((await client.query("SELECT change_sequence::text,change_kind FROM knowledge_page_changes change ORDER BY change.change_sequence")).rows).toEqual([
        { change_sequence: "9", change_kind: "updated" },
        { change_sequence: "15", change_kind: "deleted" },
      ]);
      expect((await client.query("SELECT nextval('knowledge_page_changes_change_sequence_seq')::text AS value")).rows[0]?.value).toBe("16");
      expect((await client.query("SELECT consumed_at IS NOT NULL AS consumed FROM knowledge_import_intents WHERE id=$1", [intentId])).rows[0]?.consumed).toBeTrue();
      expect((await client.query("SELECT 1 FROM knowledge_pages WHERE id=$1", [destinationPageId])).rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
