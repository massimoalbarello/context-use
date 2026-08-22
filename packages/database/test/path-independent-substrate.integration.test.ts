import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { disposableDatabaseUrl } from "../src/disposable-database.ts";
import { DocumentMaintenanceRepository } from "../src/document-maintenance.ts";
import { DocumentLinkRepository } from "../src/document-links.ts";
import { KnowledgeSettingsRepository } from "../src/knowledge-settings.ts";

const adminUrl = await disposableDatabaseUrl();
const describeDatabase = adminUrl ? describe : describe.skip;

describeDatabase("path-independent document substrate", () => {
  let admin: Client;
  let repositoryPool: Pool;

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    repositoryPool = new Pool({ connectionString: adminUrl });
  });

  afterAll(async () => {
    await repositoryPool.end();
    await admin.end();
  });

  async function createPage(path: string) {
    const pageId = randomUUID();
    const revisionId = randomUUID();
    await admin.query("BEGIN");
    try {
      await admin.query("SET CONSTRAINTS ALL DEFERRED");
      await admin.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id,search_vector)
         VALUES ($1,$2,$3,page_search_vector($2,'Fixture','Fixture summary.','Fixture body.'))`,
        [pageId, path, revisionId],
      );
      await admin.query(
         `INSERT INTO hypermedia_document_revisions(
           id,document_id,revision_number,body_object_key,body_size_bytes,body_content_hash
         ) VALUES ($1::uuid,$2,1,'documents/private/'||($1::uuid)::text||'.md',13,$3)`,
        [revisionId, pageId, "9e761a4d1d663f2f5e24d86966e012c35ca58956459f74d0f7edebc28826009f"],
      );
      await admin.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,summary,commit_message,actor_kind,actor_subject
         ) VALUES ($1,$2,1,$3,'Fixture','Fixture summary.','Create fixture','dashboard','test')`,
        [revisionId, pageId, path],
      );
      await admin.query("COMMIT");
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
    return { pageId, revisionId, path };
  }

  async function createAsset(path: string) {
    const id = randomUUID();
    await admin.query(
       `INSERT INTO assets(
         id,current_path,filename,content_type,size_bytes,content_hash,s3_object_key
       ) VALUES ($1::uuid,$2,'fixture.bin','application/octet-stream',0,$3,
         'objects/'||($1::uuid)::text)`,
      [id, path, "0".repeat(64)],
    );
    return { id, path };
  }

  test("identity attachment boundaries reject cross-kind UUID collisions", async () => {
    const asset = await createAsset(`substrate-asset-${randomUUID()}`);
    const identity = await admin.query<{
      authority: string;
      representation: string;
    }>(
      `SELECT authority::text,representation::text
       FROM hypermedia_documents WHERE id=$1`,
      [asset.id],
    );
    expect(identity.rows[0]).toEqual({
      authority: "knowledge",
      representation: "asset",
    });

    const collidingId = randomUUID();
    await admin.query(
      `INSERT INTO hypermedia_documents(id,authority,representation)
       VALUES ($1,'source','markdown')`,
      [collidingId],
    );
    await expect(admin.query(
      `INSERT INTO assets(
         id,current_path,filename,content_type,size_bytes,content_hash,s3_object_key
       ) VALUES ($1::uuid,$2,'collision.bin','application/octet-stream',0,$3,
         'objects/'||($1::uuid)::text)`,
      [collidingId, `substrate-collision-${randomUUID()}`, "0".repeat(64)],
    )).rejects.toThrow("asset identity collides");

    const page = await createPage(`substrate-identity-page-${randomUUID()}`);
    await expect(admin.query(
      `INSERT INTO assets(
         id,current_path,filename,content_type,size_bytes,content_hash,s3_object_key
       ) VALUES ($1::uuid,$2,'page-collision.bin','application/octet-stream',0,$3,
         'objects/'||($1::uuid)::text)`,
      [page.pageId, `substrate-page-collision-${randomUUID()}`, "0".repeat(64)],
    )).rejects.toThrow("asset identity collides");

    for (const documentId of [asset.id, collidingId]) {
      await expect(admin.query(
        `INSERT INTO knowledge_pages(id,current_path,current_version_id,search_vector)
         VALUES ($1,$2,$3,''::tsvector)`,
        [documentId, `substrate-page-identity-${randomUUID()}`, randomUUID()],
      )).rejects.toThrow("knowledge page identity collides");
    }

    for (const documentId of [asset.id, page.pageId]) {
      await expect(admin.query(
        `INSERT INTO source_records(
           document_id,integration,connection_id,model,source_record_id,source_updated_at
         ) VALUES ($1,'fixture','identity-collision','fixture-model',$2,now())`,
        [documentId, randomUUID()],
      )).rejects.toThrow("source record identity collides");
    }

    const invalidRevisionId = randomUUID();
    await expect(admin.query(
      `INSERT INTO hypermedia_document_revisions(
         id,document_id,revision_number,body_object_key,body_size_bytes,body_content_hash
       ) VALUES ($1::uuid,$2,1,'documents/private/'||($1::uuid)::text||'.md',0,$3)`,
      [invalidRevisionId, asset.id, "0".repeat(64)],
    )).rejects.toThrow("document revisions require Markdown");

    await expect(admin.query(
      "UPDATE hypermedia_documents SET representation='asset' WHERE id=$1",
      [page.pageId],
    )).rejects.toThrow("document authority and representation are immutable");
  });

  test("revision link indexing distinguishes zero links and cascades derived backlinks", async () => {
    const sourceDocumentId = randomUUID();
    const sourceRevisionId = randomUUID();
    const targetDocumentId = randomUUID();
    await admin.query(
      `INSERT INTO hypermedia_documents(id,authority,representation)
       VALUES ($1,'source','markdown'),($2,'source','markdown')`,
      [sourceDocumentId, targetDocumentId],
    );
    await admin.query(
      `INSERT INTO hypermedia_document_revisions(
         id,document_id,revision_number,body_object_key,body_size_bytes,body_content_hash
       ) VALUES ($1::uuid,$2,1,'documents/private/'||($1::uuid)::text||'.md',0,$3)`,
      [sourceRevisionId, sourceDocumentId, "0".repeat(64)],
    );

    await admin.query("BEGIN");
    await admin.query("SET LOCAL ROLE context_use_storage");
    await admin.query("SELECT replace_document_links($1,$2::uuid[])", [sourceRevisionId, []]);
    await admin.query("COMMIT");
    const empty = await admin.query<{ links_indexed_at: Date | null; count: string }>(
      `SELECT revision.links_indexed_at,count(link.*)::text AS count
       FROM hypermedia_document_revisions revision
       LEFT JOIN document_links link ON link.source_revision_id=revision.id
       WHERE revision.id=$1
       GROUP BY revision.id`,
      [sourceRevisionId],
    );
    expect(empty.rows[0]?.links_indexed_at).not.toBeNull();
    expect(empty.rows[0]?.count).toBe("0");

    await admin.query(
      "SELECT replace_document_links($1,$2::uuid[])",
      [sourceRevisionId, [targetDocumentId, targetDocumentId, randomUUID()]],
    );
    expect((await admin.query(
      `SELECT 1 FROM document_links
       WHERE source_revision_id=$1 AND target_document_id=$2`,
      [sourceRevisionId, targetDocumentId],
    )).rowCount).toBe(1);

    await admin.query("DELETE FROM hypermedia_documents WHERE id=$1", [targetDocumentId]);
    expect((await admin.query(
      "SELECT 1 FROM document_links WHERE target_document_id=$1",
      [targetDocumentId],
    )).rowCount).toBe(0);
    expect((await admin.query(
      "SELECT 1 FROM hypermedia_document_revisions WHERE id=$1",
      [sourceRevisionId],
    )).rowCount).toBe(1);
  });

  test("a failed revision attempt rotates behind work beyond the current batch", async () => {
    const maintenance = new DocumentMaintenanceRepository(repositoryPool);
    await admin.query(
      `SELECT replace_document_links(id,'{}'::uuid[])
       FROM hypermedia_document_revisions
       WHERE links_indexed_at IS NULL`,
    );
    const documentIds = [randomUUID(), randomUUID(), randomUUID()];
    const revisionIds = [randomUUID(), randomUUID(), randomUUID()];
    for (let index = 0; index < revisionIds.length; index += 1) {
      await admin.query(
        `INSERT INTO hypermedia_documents(id,authority,representation,created_at,updated_at)
         VALUES ($1,'source','markdown',now()+($2::text||' milliseconds')::interval,
           now()+($2::text||' milliseconds')::interval)`,
        [documentIds[index], index],
      );
      await admin.query(
        `INSERT INTO hypermedia_document_revisions(
         id,document_id,revision_number,body_object_key,body_size_bytes,
           body_content_hash,created_at
         ) VALUES ($1::uuid,$2,1,'documents/private/'||($1::uuid)::text||'.md',0,$3,
           now()+($4::text||' milliseconds')::interval)`,
        [revisionIds[index], documentIds[index], "0".repeat(64), index],
      );
    }

    const firstBatch = await maintenance.unindexedLinkRevisions(2);
    expect(firstBatch.map(({ revision_id }) => revision_id)).toEqual(revisionIds.slice(0, 2));
    await maintenance.deferRevisionLinks(revisionIds[0]!);
    const secondBatch = await maintenance.unindexedLinkRevisions(2);
    expect(new Set(secondBatch.map(({ revision_id }) => revision_id)))
      .toEqual(new Set(revisionIds.slice(1)));

    await admin.query("DELETE FROM hypermedia_documents WHERE id=ANY($1::uuid[])", [documentIds]);
  });

  test("backlinks follow only current, active source revisions", async () => {
    const links = new DocumentLinkRepository(repositoryPool);
    const target = await createPage(`substrate-backlink-target-${randomUUID()}`);
    const source = await createPage(`substrate-backlink-source-${randomUUID()}`);

    await links.replaceRevisionTargets(source.revisionId, [target.pageId]);
    expect((await links.backlinks(target.pageId)).backlinks.map((link) => link.source_revision_id))
      .toEqual([source.revisionId]);

    const secondRevisionId = randomUUID();
    await admin.query("BEGIN");
    try {
      await admin.query("SET CONSTRAINTS ALL DEFERRED");
      await admin.query(
        `INSERT INTO hypermedia_document_revisions(
           id,document_id,revision_number,body_object_key,body_size_bytes,body_content_hash
         ) VALUES ($1::uuid,$2,2,'documents/private/'||($1::uuid)::text||'.md',14,$3)`,
        [secondRevisionId, source.pageId, "1".repeat(64)],
      );
      await admin.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,summary,commit_message,actor_kind,actor_subject
         ) VALUES ($1,$2,2,$3,'Fixture revised','Fixture summary.',
           'Revise fixture','dashboard','test')`,
        [secondRevisionId, source.pageId, source.path],
      );
      await admin.query(
        `UPDATE knowledge_pages
         SET current_version_id=$2,updated_at=now()
         WHERE id=$1`,
        [source.pageId, secondRevisionId],
      );
      await admin.query("COMMIT");
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }

    await links.replaceRevisionTargets(secondRevisionId, []);
    expect(await links.backlinks(target.pageId)).toEqual({ backlinks: [], has_more: false });
    expect((await admin.query(
      `SELECT 1 FROM document_links
       WHERE source_revision_id=$1 AND target_document_id=$2`,
      [source.revisionId, target.pageId],
    )).rowCount).toBe(1);

    await links.replaceRevisionTargets(secondRevisionId, [target.pageId]);
    expect((await links.backlinks(target.pageId)).backlinks.map((link) => link.source_revision_id))
      .toEqual([secondRevisionId]);

    const recordDocumentId = randomUUID();
    const recordRevisionId = randomUUID();
    await admin.query(
      `INSERT INTO hypermedia_documents(id,authority,representation)
       VALUES ($1,'source','markdown')`,
      [recordDocumentId],
    );
    await admin.query(
      `INSERT INTO hypermedia_document_revisions(
         id,document_id,revision_number,body_object_key,body_size_bytes,body_content_hash
       ) VALUES ($1::uuid,$2,1,'documents/private/'||($1::uuid)::text||'.md',0,$3)`,
      [recordRevisionId, recordDocumentId, "2".repeat(64)],
    );
    await admin.query(
      `INSERT INTO source_records(
         document_id,current_revision_id,integration,connection_id,model,
         source_record_id,source_updated_at
       ) VALUES ($1,$2,'fixture','fixture-connection','fixture-model',$3,now())`,
      [recordDocumentId, recordRevisionId, randomUUID()],
    );
    await links.replaceRevisionTargets(recordRevisionId, [target.pageId]);
    const complete = await links.backlinks(target.pageId);
    expect(new Set(complete.backlinks.map((link) => link.source_revision_id)))
      .toEqual(new Set([secondRevisionId, recordRevisionId]));
    expect(complete.has_more).toBe(false);
    expect(await links.backlinks(target.pageId, 1)).toMatchObject({ has_more: true });

    await admin.query(
      "UPDATE source_records SET deleted_at=now() WHERE document_id=$1",
      [recordDocumentId],
    );
    expect((await links.backlinks(target.pageId)).backlinks.map((link) => link.source_revision_id))
      .toEqual([secondRevisionId]);

    await admin.query("UPDATE knowledge_pages SET archived_at=now() WHERE id=$1", [source.pageId]);
    expect(await links.backlinks(target.pageId)).toEqual({ backlinks: [], has_more: false });
  });

  test("backlink completeness tracks every active current page and record revision", async () => {
    const links = new DocumentLinkRepository(repositoryPool);
    await admin.query(
      `UPDATE hypermedia_document_revisions revision
       SET links_indexed_at=coalesce(revision.links_indexed_at,now())
       FROM (
         SELECT page.id AS document_id,page.current_version_id AS revision_id
         FROM knowledge_pages page
         WHERE page.archived_at IS NULL
         UNION ALL
         SELECT record.document_id,record.current_revision_id
         FROM source_records record
         WHERE record.deleted_at IS NULL AND record.current_revision_id IS NOT NULL
       ) current_source
       WHERE revision.document_id=current_source.document_id
         AND revision.id=current_source.revision_id`,
    );
    expect(await links.backlinksComplete()).toBe(true);

    const page = await createPage(`substrate-completeness-page-${randomUUID()}`);
    expect(await links.backlinksComplete()).toBe(false);
    await admin.query("UPDATE knowledge_pages SET archived_at=now() WHERE id=$1", [page.pageId]);
    expect(await links.backlinksComplete()).toBe(true);

    const recordDocumentId = randomUUID();
    const recordRevisionId = randomUUID();
    await admin.query(
      `INSERT INTO hypermedia_documents(id,authority,representation)
       VALUES ($1,'source','markdown')`,
      [recordDocumentId],
    );
    await admin.query(
      `INSERT INTO hypermedia_document_revisions(
         id,document_id,revision_number,body_object_key,body_size_bytes,body_content_hash
       ) VALUES ($1::uuid,$2,1,'documents/private/'||($1::uuid)::text||'.md',0,$3)`,
      [recordRevisionId, recordDocumentId, "3".repeat(64)],
    );
    await admin.query(
      `INSERT INTO source_records(
         document_id,current_revision_id,integration,connection_id,model,
         source_record_id,source_updated_at
       ) VALUES ($1,$2,'fixture','fixture-completeness','fixture-model',$3,now())`,
      [recordDocumentId, recordRevisionId, randomUUID()],
    );
    expect(await links.backlinksComplete()).toBe(false);

    await admin.query(
      "UPDATE source_records SET deleted_at=now() WHERE document_id=$1",
      [recordDocumentId],
    );
    expect(await links.backlinksComplete()).toBe(true);
    await admin.query(
      "UPDATE source_records SET deleted_at=NULL WHERE document_id=$1",
      [recordDocumentId],
    );
    expect(await links.backlinksComplete()).toBe(false);

    await links.replaceRevisionTargets(recordRevisionId, []);
    expect(await links.backlinksComplete()).toBe(true);
    await admin.query(
      "UPDATE source_records SET deleted_at=now() WHERE document_id=$1",
      [recordDocumentId],
    );
  });

  test("configured global guide is an active knowledge page and is protected", async () => {
    const previous = await admin.query<{ global_guide_document_id: string | null }>(
      `SELECT global_guide_document_id
       FROM knowledge_settings
       WHERE singleton`,
    );
    const guide = await createPage(`substrate-guide-${randomUUID()}`);
    try {
      await admin.query(
        `UPDATE knowledge_settings
         SET global_guide_document_id=$1,updated_at=now()
         WHERE singleton`,
        [guide.pageId],
      );
      const configured = await new KnowledgeSettingsRepository(repositoryPool).globalGuide();
      expect(configured).toMatchObject({
        document_id: guide.pageId,
        current_revision_id: guide.revisionId,
        revision_number: 1,
        title: "Fixture",
      });
      expect(configured).not.toHaveProperty("version_number");

      await expect(admin.query(
        "UPDATE knowledge_pages SET archived_at=now() WHERE id=$1",
        [guide.pageId],
      )).rejects.toThrow("configured global knowledge guide");
      await expect(admin.query(
        "UPDATE knowledge_pages SET current_path=$2 WHERE id=$1",
        [guide.pageId, `substrate-moved-guide-${randomUUID()}`],
      )).rejects.toThrow("configured global knowledge guide");
      await expect(admin.query(
        "DELETE FROM knowledge_pages WHERE id=$1",
        [guide.pageId],
      )).rejects.toThrow("configured global knowledge guide");
      await expect(admin.query(
        "DELETE FROM hypermedia_documents WHERE id=$1",
        [guide.pageId],
      )).rejects.toThrow();

      const asset = await createAsset(`substrate-guide-asset-${randomUUID()}`);
      await expect(admin.query(
        `UPDATE knowledge_settings
         SET global_guide_document_id=$1,updated_at=now()
         WHERE singleton`,
        [asset.id],
      )).rejects.toThrow("global guide must be an active knowledge document");
    } finally {
      await admin.query(
        `UPDATE knowledge_settings
         SET global_guide_document_id=$1,updated_at=now()
         WHERE singleton`,
        [previous.rows[0]?.global_guide_document_id ?? null],
      );
    }
  });

  test("guide configuration serializes with a concurrent archive", async () => {
    const previous = await admin.query<{ global_guide_document_id: string | null }>(
      `SELECT global_guide_document_id
       FROM knowledge_settings
       WHERE singleton`,
    );
    const guide = await createPage(`substrate-concurrent-guide-${randomUUID()}`);
    const archiver = new Client({
      connectionString: adminUrl,
      application_name: "context-use-test-guide-archiver",
    });
    const configurer = new Client({
      connectionString: adminUrl,
      application_name: "context-use-test-guide-configurer",
    });
    await archiver.connect();
    await configurer.connect();
    const configurerPid = (await configurer.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    )).rows[0]!.pid;
    try {
      await archiver.query("BEGIN");
      await archiver.query(
        "UPDATE knowledge_pages SET archived_at=now() WHERE id=$1",
        [guide.pageId],
      );

      const configuring = configurer.query(
        `UPDATE knowledge_settings
         SET global_guide_document_id=$1,updated_at=now()
         WHERE singleton`,
        [guide.pageId],
      );
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await admin.query<{ blocked: boolean }>(
          `SELECT coalesce(wait_event_type='Lock',false) AS blocked
           FROM pg_stat_activity WHERE pid=$1`,
          [configurerPid],
        );
        if (activity.rows[0]?.blocked) {
          blocked = true;
          break;
        }
        await Bun.sleep(10);
      }
      expect(blocked).toBe(true);

      await archiver.query("COMMIT");
      await expect(configuring).rejects.toThrow("global guide must be an active knowledge document");
      expect((await admin.query(
        `SELECT 1 FROM knowledge_settings
         WHERE singleton AND global_guide_document_id=$1`,
        [guide.pageId],
      )).rowCount).toBe(0);
    } finally {
      await archiver.query("ROLLBACK").catch(() => undefined);
      await admin.query("UPDATE knowledge_pages SET archived_at=NULL WHERE id=$1", [guide.pageId]);
      await admin.query(
        `UPDATE knowledge_settings
         SET global_guide_document_id=$1,updated_at=now()
         WHERE singleton`,
        [previous.rows[0]?.global_guide_document_id ?? null],
      );
      await Promise.all([archiver.end(), configurer.end()]);
    }
  });

  test("public IDs and exact aliases persist without indexing private paths", async () => {
    const first = await createPage(`substrate-public-${randomUUID()}`);
    expect((await admin.query(
      "SELECT 1 FROM public_resources WHERE document_id=$1",
      [first.pageId],
    )).rowCount).toBe(0);

    await admin.query(
      `UPDATE knowledge_pages
       SET published_version_id=$2,public_path=$3,updated_at=now()
       WHERE id=$1`,
      [first.pageId, first.revisionId, first.path],
    );
    const resource = await admin.query<{ public_id: string }>(
      "SELECT public_id FROM public_resources WHERE document_id=$1",
      [first.pageId],
    );
    const publicId = resource.rows[0]!.public_id;
    const aliases = await admin.query<{ alias_path: string; route_kind: string }>(
      `SELECT alias_path,route_kind::text
       FROM public_route_aliases alias
       WHERE public_id=$1
       ORDER BY alias.route_kind`,
      [publicId],
    );
    expect(aliases.rows).toEqual([
      { alias_path: `/p/${first.path}`, route_kind: "page" },
      { alias_path: `/p/${first.path}.md`, route_kind: "markdown" },
    ]);
    expect(publicId).not.toBe(first.pageId);

    await admin.query(
      `UPDATE knowledge_pages
       SET published_version_id=NULL,public_path=NULL,updated_at=now()
       WHERE id=$1`,
      [first.pageId],
    );
    expect((await admin.query(
      "SELECT 1 FROM public_route_aliases WHERE public_id=$1",
      [publicId],
    )).rowCount).toBe(2);
    expect((await admin.query(
      "SELECT 1 FROM published_route_aliases WHERE public_id=$1",
      [publicId],
    )).rowCount).toBe(0);

    const second = await createPage(`substrate-public-${randomUUID()}`);
    await expect(admin.query(
      `UPDATE knowledge_pages
       SET published_version_id=$2,public_path=$3,updated_at=now()
       WHERE id=$1`,
      [second.pageId, second.revisionId, first.path],
    )).rejects.toThrow("public route alias is permanently assigned");
  });

  test("asset deletion tombstones public identity and preserves its alias", async () => {
    const asset = await createAsset(`substrate-public-asset-${randomUUID()}`);
    await admin.query("UPDATE assets SET public_path=current_path WHERE id=$1", [asset.id]);
    const resource = await admin.query<{ public_id: string }>(
      "SELECT public_id FROM public_resources WHERE document_id=$1",
      [asset.id],
    );
    const publicId = resource.rows[0]!.public_id;
    expect((await admin.query(
      `SELECT 1 FROM public_route_aliases
       WHERE public_id=$1 AND alias_path=$2 AND route_kind='asset'`,
      [publicId, `/a/${asset.path}`],
    )).rowCount).toBe(1);

    await admin.query("UPDATE assets SET public_path=NULL WHERE id=$1", [asset.id]);
    await admin.query("DELETE FROM assets WHERE id=$1", [asset.id]);
    expect((await admin.query<{ document_id: string | null }>(
      "SELECT document_id FROM public_resources WHERE public_id=$1",
      [publicId],
    )).rows[0]?.document_id).toBeNull();
    expect((await admin.query(
      "SELECT 1 FROM public_route_aliases WHERE public_id=$1",
      [publicId],
    )).rowCount).toBe(1);
    expect((await admin.query(
      "SELECT 1 FROM published_route_aliases WHERE public_id=$1",
      [publicId],
    )).rowCount).toBe(0);
  });

  test("roles can use only the path-independent capabilities they need", async () => {
    expect((await admin.query<{ allowed: boolean }>(
      `SELECT has_function_privilege(
         'context_use_mcp','replace_source_record_search_chunks(uuid,text[])','EXECUTE'
       ) AS allowed`,
    )).rows[0]?.allowed).toBe(true);
    for (const role of [
      "context_use_auth",
      "context_use_dashboard",
      "context_use_public",
      "context_use_confirmation",
      "context_use_storage",
      "context_use_backup",
    ]) {
      expect((await admin.query<{ allowed: boolean }>(
        `SELECT has_function_privilege(
           $1,'replace_source_record_search_chunks(uuid,text[])','EXECUTE'
         ) AS allowed`,
        [role],
      )).rows[0]?.allowed).toBe(false);
    }
    for (const role of [
      "context_use_auth",
      "context_use_dashboard",
      "context_use_public",
      "context_use_confirmation",
      "context_use_storage",
    ]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_table_privilege($1,'source_record_search_chunks','SELECT') AS allowed",
        [role],
      )).rows[0]?.allowed).toBe(false);
    }

    for (const role of ["context_use_dashboard", "context_use_mcp", "context_use_storage"]) {
      expect((await admin.query<{ allowed: boolean }>(
        `SELECT has_function_privilege(
           $1,'replace_document_links(uuid,uuid[])','EXECUTE'
         ) AS allowed`,
        [role],
      )).rows[0]?.allowed).toBe(true);
    }
    for (const role of ["context_use_auth", "context_use_public", "context_use_confirmation", "context_use_backup"]) {
      expect((await admin.query<{ allowed: boolean }>(
        `SELECT has_function_privilege(
           $1,'replace_document_links(uuid,uuid[])','EXECUTE'
         ) AS allowed`,
        [role],
      )).rows[0]?.allowed).toBe(false);
    }
    expect((await admin.query<{ allowed: boolean }>(
      `SELECT has_function_privilege(
         'context_use_storage','defer_document_link_index(uuid)','EXECUTE'
       ) AS allowed`,
    )).rows[0]?.allowed).toBe(true);
    for (const role of ["context_use_dashboard", "context_use_mcp", "context_use_public"]) {
      expect((await admin.query<{ allowed: boolean }>(
        `SELECT has_function_privilege(
           $1,'defer_document_link_index(uuid)','EXECUTE'
         ) AS allowed`,
        [role],
      )).rows[0]?.allowed).toBe(false);
    }

    for (const role of ["context_use_public", "context_use_storage"]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_table_privilege($1,'published_route_aliases','SELECT') AS allowed",
        [role],
      )).rows[0]?.allowed).toBe(true);
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_table_privilege($1,'public_route_aliases','SELECT') AS allowed",
        [role],
      )).rows[0]?.allowed).toBe(false);
    }

    for (const role of ["context_use_dashboard", "context_use_mcp", "context_use_public", "context_use_storage"]) {
      for (const table of ["public_resources", "public_route_aliases"]) {
        expect((await admin.query<{ allowed: boolean }>(
          "SELECT has_table_privilege($1,$2,'INSERT,UPDATE,DELETE') AS allowed",
          [role, table],
        )).rows[0]?.allowed).toBe(false);
      }
    }
    expect((await admin.query<{ allowed: boolean }>(
      `SELECT has_column_privilege(
         'context_use_dashboard','knowledge_settings','global_guide_document_id','UPDATE'
       ) AS allowed`,
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      `SELECT has_column_privilege(
         'context_use_mcp','knowledge_settings','global_guide_document_id','UPDATE'
       ) AS allowed`,
    )).rows[0]?.allowed).toBe(false);
    expect((await admin.query<{ allowed: boolean }>(
      `SELECT has_column_privilege(
         'context_use_mcp','hypermedia_documents','updated_at','UPDATE'
       ) AS allowed`,
    )).rows[0]?.allowed).toBe(true);
    for (const relation of ["hypermedia_documents", "hypermedia_document_revisions"]) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_table_privilege('context_use_storage',$1,'INSERT') AS allowed",
        [relation],
      )).rows[0]?.allowed).toBe(false);
    }
    for (const column of ["id", "current_version_id", "archived_at"] as const) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_column_privilege('context_use_storage','knowledge_pages',$1,'SELECT') AS allowed",
        [column],
      )).rows[0]?.allowed).toBe(true);
    }
    for (const column of ["document_id", "current_revision_id", "deleted_at"] as const) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_column_privilege('context_use_storage','source_records',$1,'SELECT') AS allowed",
        [column],
      )).rows[0]?.allowed).toBe(true);
    }
    expect((await admin.query<{ allowed: boolean }>(
      `SELECT has_column_privilege(
         'context_use_storage','source_records','connection_id','SELECT'
       ) AS allowed`,
    )).rows[0]?.allowed).toBe(false);
    await admin.query("BEGIN");
    try {
      await admin.query("SET LOCAL ROLE context_use_storage");
      await admin.query(
        `SELECT revision.id
         FROM hypermedia_document_revisions revision
         LEFT JOIN knowledge_pages page
           ON page.current_version_id=revision.id AND page.archived_at IS NULL
         LEFT JOIN source_records record
           ON record.current_revision_id=revision.id AND record.deleted_at IS NULL
         WHERE revision.links_indexed_at IS NULL
         ORDER BY (page.id IS NOT NULL OR record.document_id IS NOT NULL) DESC
         LIMIT 1`,
      );
    } finally {
      await admin.query("ROLLBACK");
    }
    for (const column of ["authority", "representation"] as const) {
      expect((await admin.query<{ allowed: boolean }>(
        "SELECT has_column_privilege('context_use_mcp','hypermedia_documents',$1,'UPDATE') AS allowed",
        [column],
      )).rows[0]?.allowed).toBe(false);
    }
    expect((await admin.query<{ allowed: boolean }>(
      `SELECT has_column_privilege(
         'context_use_mcp','source_records','deleted_at','UPDATE'
       ) AS allowed`,
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      `SELECT has_column_privilege(
         'context_use_mcp','source_records','connection_id','UPDATE'
       ) AS allowed`,
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      `SELECT has_column_privilege(
         'context_use_mcp','source_records','document_id','UPDATE'
       ) AS allowed`,
    )).rows[0]?.allowed).toBe(false);
    expect((await admin.query<{ allowed: boolean }>(
      `SELECT has_column_privilege(
         'context_use_mcp','source_records','connection_instance_id','UPDATE'
       ) AS allowed`,
    )).rows[0]?.allowed).toBe(false);
    expect((await admin.query<{ allowed: boolean }>(
      `SELECT has_column_privilege(
         'context_use_mcp','source_records','connection_instance_id','INSERT'
       ) AS allowed`,
    )).rows[0]?.allowed).toBe(true);
    expect((await admin.query<{ allowed: boolean }>(
      `SELECT has_column_privilege(
         'context_use_reset_owner','knowledge_settings','global_guide_document_id','SELECT'
       ) AS allowed`,
    )).rows[0]?.allowed).toBe(true);
  });
});
