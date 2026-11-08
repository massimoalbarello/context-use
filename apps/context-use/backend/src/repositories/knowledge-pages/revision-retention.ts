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
  // Prune only on saves, keeping the union of the latest revisions and the inclusive time window.
  // Current publication and valid pending approvals protect extra revisions until that use ends.
  // Publication, approval creation, and this save share the database write lock.

  // SQLite and object storage cannot share a transaction. Deleting objects first could leave
  // readable or publishable revisions without content if the database transaction rolls back.
  // Deleting rows first without a queue would lose the storage keys if cleanup fails or crashes.
  // Queue the keys and remove revision rows atomically under the publication write lock, then
  // delete objects after commit and acknowledge each completed queue entry. Pending entries
  // survive restarts and retry on the same page's next successful save; there is no background retry.
  await db`
    insert into "knowledge_page_revision_deletion_queue" ("storage_key", "owner_id", "page_id")
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
        select "storage_key" from "knowledge_page_revision_deletion_queue"
        where "owner_id" = ${ownerId} and "page_id" = ${pageId}
      )
  `;
}
