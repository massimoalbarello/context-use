import type { TypedSQL } from '@ilbertt/bun-sqlgen';
import {
  type ChangeContext,
  MAX_CHANGE_MESSAGE_LENGTH,
  type ResourceChange,
} from '#backend/models/history/model.ts';
import type { Queries } from '#backend/queries.gen.ts';

export async function recordChange({
  db,
  ownerId,
  change,
  ...event
}: {
  db: TypedSQL<Queries>;
  ownerId: string;
  change: ChangeContext;
} & Pick<
  ResourceChange,
  'resourceType' | 'readableId' | 'name' | 'action' | 'details' | 'createdAt'
> & {
    pageRevisionNumber?: number;
  }): Promise<void> {
  const message = change.message.trim();
  if (!message || message.length > MAX_CHANGE_MESSAGE_LENGTH) {
    throw new Error('A short change message is required');
  }
  await db.InsertResourceChange`
    insert into "resource_change" ("owner_id", "resource_type", "readable_id", "name", "action",
      "message", "client_name", "details", "page_revision_number", "created_at")
    values (${ownerId}, ${event.resourceType}, ${event.readableId}, ${event.name}, ${event.action},
      ${message}, ${change.clientName}, ${JSON.stringify(event.details)},
      ${event.pageRevisionNumber ?? null}, ${event.createdAt})
  `;
}
