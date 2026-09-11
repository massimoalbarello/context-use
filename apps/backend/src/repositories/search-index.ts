import type { SQL } from 'bun';
import type { HypermediaResourceType } from '#models/hypermedia-retrieval/model.ts';

/** Shared SQLite projection helper, not a writable resource capability. Callers own the transaction. */
export async function replaceSearchDocument({
  db,
  ownerId,
  resourceType,
  readableId,
  label,
  summary = '',
  body = '',
  metadata = '',
  participantNames = [],
}: {
  db: SQL;
  ownerId: string;
  resourceType: HypermediaResourceType;
  readableId: string;
  label: string;
  summary?: string;
  body?: string;
  metadata?: string;
  participantNames?: string[];
}): Promise<void> {
  const rows = await db<Array<{ id: number }>>`
    insert into "hypermedia_search_document" ("owner_id", "resource_type", "readable_id", "participant_names")
    values (${ownerId}, ${resourceType}, ${readableId}, ${JSON.stringify(participantNames)})
    on conflict ("owner_id", "resource_type", "readable_id") do update set
      "participant_names" = excluded."participant_names"
    returning "id"
  `;
  const row = rows[0];
  if (!row) {
    throw new Error('Search document could not be indexed');
  }
  await db`
    insert or replace into "hypermedia_search_fts" ("rowid", "readable_id", "label", "summary", "body", "metadata")
    values (${row.id}, ${readableId}, ${label}, ${summary}, ${body}, ${metadata})
  `;
}
