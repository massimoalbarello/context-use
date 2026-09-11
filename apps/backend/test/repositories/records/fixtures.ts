import type { SQL } from 'bun';
import { OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import type { Storage } from '#lib/storage/storage.ts';
import type {
  DeliveredRecord,
  RecordContent,
  RecordDeliveryEnvelope,
} from '#models/records/delivery-contract.generated.ts';

const UUID_SUFFIX_LENGTH = 12;

export const OWNER_ID = OWNER_USER_ID;
export const SECOND_OWNER_ID = 'owner-b';
export const SYNC_ID = '01991f43-0c00-7000-8000-000000000001';
const SYNC_READABLE_ID = 'receiver-a';
export const SECOND_SYNC_ID = '01991f43-0c00-7000-8000-000000000002';
export const SECOND_SYNC_READABLE_ID = 'receiver-b';
export const RECEIVED_AT = new Date('2026-09-08T08:00:00.000Z');
export const INITIAL_REVISION = 1;
export const STALE_REVISION = 2;
export const CURRENT_REVISION = 3;
export const DELETED_REVISION = 4;

export function digest(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function content(body: string): RecordContent {
  return {
    body,
    sourceUrl: 'https://example.invalid/records/record-1',
    sourceCreatedAt: '2025-01-02T03:04:05-04:00',
    sourceUpdatedAt: '2026-08-09T10:11:12+05:30',
    participants: [
      {
        identities: [{ namespace: 'github', id: 'octocat' }],
        roles: ['author'],
        name: 'Octo Cat',
      },
    ],
    attributes: { nested: { answer: 42, enabled: true } },
  };
}

export function activeRecord({
  eventId,
  recordId = 'record-1',
  revision = INITIAL_REVISION,
  body = 'initial Markdown body',
}: {
  eventId: string;
  recordId?: string;
  revision?: number;
  body?: string;
}): Exclude<DeliveredRecord, { operation: 'deleted' }> {
  const recordContent = content(body);
  return {
    eventId: `00000000-0000-4000-8000-${digest(eventId).slice(-UUID_SUFFIX_LENGTH)}`,
    provider: 'github',
    sourceId: 'github.example',
    kind: 'pull-request',
    id: recordId,
    revision,
    operation: revision === INITIAL_REVISION ? 'added' : 'updated',
    contentHash: digest(JSON.stringify(recordContent)),
    committedAt: '2026-08-09T10:11:12+05:30',
    content: recordContent,
  };
}

export function deletedRecord({ eventId, revision }: { eventId: string; revision: number }) {
  return {
    eventId: `00000000-0000-4000-8000-${digest(eventId).slice(-UUID_SUFFIX_LENGTH)}`,
    provider: 'github',
    sourceId: 'github.example',
    kind: 'pull-request',
    id: 'record-1',
    revision,
    operation: 'deleted',
    contentHash: digest('deleted'),
    committedAt: '2026-09-01T02:03:04-07:00',
  } satisfies DeliveredRecord;
}

export function envelope({
  batchId,
  records,
}: {
  batchId: string;
  records: DeliveredRecord[];
}): RecordDeliveryEnvelope {
  return { version: 1, batchId, records };
}

export async function insertOwner({
  database,
  ownerId,
}: {
  database: SQL;
  ownerId: string;
}): Promise<void> {
  const timestamp = RECEIVED_AT.toISOString();
  await database`
    insert into "auth_user"
      ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
    values (${ownerId}, ${ownerId}, ${`${ownerId}@example.invalid`}, 1, ${timestamp}, ${timestamp})
  `;
}

export async function insertSync({
  database,
  syncId = SYNC_ID,
  readableId = SYNC_READABLE_ID,
  ownerId = OWNER_ID,
}: {
  database: SQL;
  syncId?: string;
  readableId?: string;
  ownerId?: string;
}): Promise<void> {
  await database`
    insert into "record_sync"
      ("id", "owner_id", "readable_id", "name", "api_key_sha256", "created_at")
    values
      (${syncId}, ${ownerId}, ${readableId}, ${readableId}, ${digest(`${syncId}-key`)},
       ${RECEIVED_AT.toISOString()})
  `;
}

export async function recordCount(database: SQL): Promise<number> {
  const [count] = await database<Array<{ total: number }>>`
    select count(*) as "total" from "record_delivery_head"
  `;
  return Number(count?.total ?? 0);
}

export async function storedRecord({
  database,
  storage,
  syncId = SYNC_ID,
  recordId = 'record-1',
}: {
  database: SQL;
  storage: Storage;
  syncId?: string;
  recordId?: string;
}) {
  const identityKey = digest(JSON.stringify(['github.example', 'pull-request', recordId]));
  const [head] = await database<Array<{ storageKey: string }>>`
    select "storage_key" as "storageKey" from "record_delivery_head"
    where "sync_id" = ${syncId} and "identity_key" = ${identityKey}
  `;
  if (!head) {
    return undefined;
  }
  const snapshot = await storage.file(head.storageKey).text().then(JSON.parse);
  return {
    ownerId: snapshot.ownerId,
    revision: snapshot.record.revision,
    operation: snapshot.record.operation,
    markdown: snapshot.record.content?.body ?? null,
  };
}
