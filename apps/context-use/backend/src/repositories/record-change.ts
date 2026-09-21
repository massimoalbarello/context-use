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
    revisionNumber?: number;
  }): Promise<void> {
  const message = change.message.trim();
  if (!message || message.length > MAX_CHANGE_MESSAGE_LENGTH) {
    throw new Error('A short change message is required');
  }
  let name: string;
  if (change.actor.kind === 'owner') {
    const rows = await db.FindChangeOwnerName`
      select "name" from "auth_user" where "id" = ${ownerId}
    `;
    if (!rows[0]) {
      throw new Error('Change owner could not be resolved');
    }
    name = rows[0].name;
  } else {
    name = change.actor.name;
  }
  const reference =
    change.actor.kind === 'mcp_client'
      ? change.actor.clientAuthorizationId
      : change.actor.kind === 'api_key'
        ? change.actor.keyId
        : null;
  await db.InsertResourceChange`
    insert into "resource_change" ("owner_id", "resource_type", "readable_id", "name", "action",
      "message", "author_kind", "author_name", "author_reference", "details", "revision_number", "created_at")
    values (${ownerId}, ${event.resourceType}, ${event.readableId}, ${event.name}, ${event.action},
      ${message}, ${change.actor.kind}, ${name}, ${reference}, ${JSON.stringify(event.details)},
      ${event.revisionNumber ?? null}, ${event.createdAt})
  `;
}
