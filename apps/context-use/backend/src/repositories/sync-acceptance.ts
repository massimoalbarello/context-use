import type { TypedSQL } from '@ilbertt/bun-sqlgen';
import type { RecordSyncPrincipal } from '#backend/models/syncs/model.ts';
import type { Queries } from '#backend/queries.gen.ts';

/** Recheck revocation inside the same transaction that publishes sync-owned content. */
export async function isActiveSync({
  db,
  ownerId,
  syncId,
}: RecordSyncPrincipal & { db: TypedSQL<Queries> }): Promise<boolean> {
  const rows = await db.FindActiveSyncForAcceptance`
    select "id" from "record_sync"
    where "id" = ${syncId} and "owner_id" = ${ownerId} and "revoked_at" is null
  `;
  return rows.length > 0;
}
