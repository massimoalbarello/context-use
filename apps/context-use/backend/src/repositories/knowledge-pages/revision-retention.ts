import type { TypedTransactionSQL } from '@ilbertt/bun-sqlgen';
import {
  MIN_RETAINED_PAGE_REVISIONS,
  PAGE_REVISION_RETENTION_MS,
} from '#backend/models/knowledge-pages/retention.ts';
import type { Queries } from '#backend/queries.gen.ts';

export async function prunePageRevisions({
  db,
  ownerId,
  pageId,
  now,
}: {
  db: TypedTransactionSQL<Queries>;
  ownerId: string;
  pageId: string;
  now: string;
}): Promise<void> {
  const cutoff = new Date(new Date(now).getTime() - PAGE_REVISION_RETENTION_MS).toISOString();
  // Publication, approval creation, and this save share the database write lock.
  await db`
    insert into "knowledge_page_revision_blob_deletion" ("storage_key", "owner_id", "page_id")
    select revision."storage_key", revision."owner_id", revision."page_id"
    from "knowledge_page_revision" revision
    join "knowledge_page" page on page."id" = revision."page_id" and page."owner_id" = revision."owner_id"
    where revision."owner_id" = ${ownerId} and revision."page_id" = ${pageId}
      and revision."created_at" < ${cutoff}
      and revision."id" != page."current_revision_id"
      and (page."published_revision_id" is null or revision."id" != page."published_revision_id")
      and revision."id" not in (
        select recent."id" from "knowledge_page_revision" recent
        where recent."owner_id" = ${ownerId} and recent."page_id" = ${pageId}
        order by recent."revision_number" desc limit ${MIN_RETAINED_PAGE_REVISIONS}
      )
      and not exists (
        select 1 from "publication_approval" approval
        join "auth_session" session on session."id" = approval."session_id" and session."userId" = approval."owner_id"
        where approval."owner_id" = ${ownerId} and approval."readable_id" = page."readable_id"
          and approval."resource_type" = 'page' and approval."action" = 'publish'
          and approval."revision_number" = revision."revision_number"
          and approval."expires_at" > ${now} and session."expiresAt" > ${now}
      )
  `;
  await db`
    delete from "knowledge_page_revision"
    where "owner_id" = ${ownerId} and "page_id" = ${pageId}
      and "storage_key" in (
        select "storage_key" from "knowledge_page_revision_blob_deletion"
        where "owner_id" = ${ownerId} and "page_id" = ${pageId}
      )
  `;
}
