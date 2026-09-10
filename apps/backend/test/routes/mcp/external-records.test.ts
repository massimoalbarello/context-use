import { expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import type { SQL } from 'bun';
import type { McpClientAuthorizationPrincipal } from '#models/mcp-client-authorizations/model.ts';
import type { DeliveredRecord, RecordDeliveryEnvelope } from '#models/records/model.ts';
import { canonicalRecordContent } from '#models/records/model.ts';
import { RecordsRepository } from '#repositories/records/repository.ts';
import { ExternalRecordAddressSchema, externalRecordIdentity } from '#routes/mcp/coordinates.ts';
import { registerExternalRecordTools } from '#routes/mcp/external-records/tools.ts';
import { RecordsService } from '#services/records/service.ts';
import { withAuthTestDatabase } from '../../lib/auth/auth-test-database.ts';

const OWNER_A = 'external-record-owner-a';
const OWNER_B = 'external-record-owner-b';
const SYNC_A_ID = '01991f43-0c00-7000-8000-000000000030';
const SYNC_A_SECOND_ID = '01991f43-0c00-7000-8000-000000000031';
const SYNC_B_ID = '01991f43-0c00-7000-8000-000000000032';
const SYNC_A = 'receiver-a';
const SYNC_A_SECOND = 'receiver-a-second';
const SYNC_B = 'receiver-b';
const NOW = '2026-09-08T12:00:00.000Z';

function digest(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function record({
  eventId,
  recordId,
  body,
  revision = 1,
  operation = revision === 1 ? 'added' : 'updated',
}: {
  eventId: string;
  recordId: string;
  body?: string;
  revision?: number;
  operation?: 'added' | 'updated' | 'deleted';
}): DeliveredRecord {
  const content =
    operation === 'deleted'
      ? undefined
      : {
          body: body!,
          sourceUrl: `https://github.example/pull/${recordId}`,
          sourceCreatedAt: '2026-09-01T08:00:00.123456Z',
          sourceUpdatedAt: '2026-09-08T11:59:59.987654Z',
          participants: [
            {
              identities: [{ namespace: 'github', id: 'octocat' }],
              roles: ['author'],
              name: 'Octo Cat',
            },
          ],
          attributes: { repository: 'octo/example', number: 42, draft: false },
        };
  return {
    eventId,
    provider: 'github',
    sourceId: 'github-account',
    kind: 'pull-request',
    id: recordId,
    revision,
    operation,
    contentHash: content ? digest(canonicalRecordContent(content)!) : digest('deleted'),
    committedAt: NOW,
    ...(content ? { content } : {}),
  };
}

async function insertOwner({
  database,
  ownerId,
}: {
  database: SQL;
  ownerId: string;
}): Promise<void> {
  await database`
    insert into "auth_user"
      ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
    values (${ownerId}, ${ownerId}, ${`${ownerId}@example.invalid`}, 1, ${NOW}, ${NOW})
  `;
}

async function insertSync({
  database,
  id,
  ownerId,
  readableId,
}: {
  database: SQL;
  id: string;
  ownerId: string;
  readableId: string;
}): Promise<void> {
  await database`
    insert into "record_sync"
      ("id", "owner_id", "readable_id", "name", "api_key_sha256", "created_at")
    values (
      ${id}, ${ownerId}, ${readableId}, ${readableId},
      ${digest(`api-key:${id}`)}, ${NOW}
    )
  `;
}

async function withExternalRecordClient<T>({
  ownerId,
  recordsService,
  run,
}: {
  ownerId: string;
  recordsService: RecordsService;
  run: (client: Client) => Promise<T>;
}): Promise<T> {
  const principal: McpClientAuthorizationPrincipal = {
    ownerId,
    clientAuthorizationId: `${ownerId}-client`,
    clientAuthorizationName: 'Research agent',
  };
  const server = new McpServer({ name: 'external-record-test', version: '1.0.0' });
  registerExternalRecordTools({ server, principal, recordsService });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'external-record-test', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

async function accept({
  service,
  syncId,
  ownerId,
  batchId,
  records,
}: {
  service: RecordsService;
  syncId: string;
  ownerId: string;
  batchId: string;
  records: DeliveredRecord[];
}): Promise<void> {
  const envelope: RecordDeliveryEnvelope = { version: 1, batchId, records };
  expect(
    await service.accept({
      syncId,
      ownerId,
      envelope,
    }),
  ).toEqual({ state: 'accepted' });
}

function successfulResult<T>(result: Awaited<ReturnType<Client['callTool']>>): T {
  if (result.isError) {
    throw new Error(JSON.stringify(result.structuredContent));
  }
  return result.structuredContent as T;
}

test('MCP searches owner-wide external records and reads only the current owner-visible record', async () => {
  await withAuthTestDatabase({
    run: async (database) => {
      await insertOwner({ database, ownerId: OWNER_A });
      await insertOwner({ database, ownerId: OWNER_B });
      const repository = new RecordsRepository(database);
      const service = new RecordsService({
        records: repository,
        now: () => new Date(NOW),
      });
      for (const [id, readableId, ownerId] of [
        [SYNC_A_ID, SYNC_A, OWNER_A],
        [SYNC_A_SECOND_ID, SYNC_A_SECOND, OWNER_A],
        [SYNC_B_ID, SYNC_B, OWNER_B],
      ] as const) {
        await insertSync({ database, id, ownerId, readableId });
      }
      await accept({
        service,
        syncId: SYNC_A_ID,
        ownerId: OWNER_A,
        batchId: 'batch-owner-a-first',
        records: [
          record({
            eventId: 'event-owner-a-first',
            recordId: 'owner-a-first',
            body: '# First PR\n\nSharedneedle implementation evidence.',
          }),
        ],
      });
      await accept({
        service,
        syncId: SYNC_A_SECOND_ID,
        ownerId: OWNER_A,
        batchId: 'batch-owner-a-second',
        records: [
          record({
            eventId: 'event-owner-a-second',
            recordId: 'owner-a-second',
            body: '# Second PR\n\nSharedneedle review evidence.',
          }),
        ],
      });
      await accept({
        service,
        syncId: SYNC_B_ID,
        ownerId: OWNER_B,
        batchId: 'batch-owner-b',
        records: [
          record({
            eventId: 'event-owner-b',
            recordId: 'owner-b-only',
            body: '# Private PR\n\nSharedneedle other-owner evidence.',
          }),
        ],
      });
      let firstAddress = '';
      let ownerBAddress = '';
      await withExternalRecordClient({
        ownerId: OWNER_A,
        recordsService: service,
        run: async (client) => {
          const { tools } = await client.listTools();
          expect(tools.map(({ name }) => name)).toEqual([
            'search_external_records',
            'read_external_record',
          ]);
          expect(tools.every(({ annotations }) => annotations?.readOnlyHint === true)).toBe(true);

          const search = successfulResult<{
            items: Array<{ address: string; recordId: string; matchExcerpt: string | null }>;
          }>(
            await client.callTool({
              name: 'search_external_records',
              arguments: { query: 'sharedneedle', limit: 10 },
            }),
          );
          expect(search.items.map(({ recordId }) => recordId).sort()).toEqual([
            'owner-a-first',
            'owner-a-second',
          ]);
          expect(
            search.items.every(({ matchExcerpt }) => matchExcerpt?.includes('Sharedneedle')),
          ).toBe(true);
          firstAddress = search.items.find(({ recordId }) => recordId === 'owner-a-first')!.address;
          expect(externalRecordIdentity(firstAddress)).toEqual({
            syncReadableId: SYNC_A,
            sourceId: 'github-account',
            kind: 'pull-request',
            recordId: 'owner-a-first',
          });
          const unknownVersionAddress = `context-use://external-record/${Buffer.from(
            JSON.stringify([2, SYNC_A, 'github-account', 'pull-request', 'owner-a-first']),
            'utf8',
          ).toString('base64url')}`;
          expect(ExternalRecordAddressSchema.safeParse(unknownVersionAddress).success).toBe(false);
          expect(ExternalRecordAddressSchema.safeParse(`${firstAddress}=`).success).toBe(false);

          const detail = successfulResult<{
            address: string;
            recordId: string;
            operation: string;
            content: {
              body: string;
            };
          }>(
            await client.callTool({
              name: 'read_external_record',
              arguments: { address: firstAddress },
            }),
          );
          expect(detail).toMatchObject({
            address: firstAddress,
            recordId: 'owner-a-first',
            operation: 'added',
            content: {
              body: '# First PR\n\nSharedneedle implementation evidence.',
            },
          });
          expect(Object.keys(detail.content)).toEqual(['body']);
          expect(JSON.stringify(detail)).not.toContain(OWNER_A);
          expect(JSON.stringify(detail)).not.toContain('currentEventId');
        },
      });

      await withExternalRecordClient({
        ownerId: OWNER_B,
        recordsService: service,
        run: async (client) => {
          const search = successfulResult<{ items: Array<{ address: string }> }>(
            await client.callTool({
              name: 'search_external_records',
              arguments: { query: 'sharedneedle' },
            }),
          );
          expect(search.items).toHaveLength(1);
          ownerBAddress = search.items[0]!.address;

          const crossOwnerRead = await client.callTool({
            name: 'read_external_record',
            arguments: { address: firstAddress },
          });
          expect(crossOwnerRead.isError).toBe(true);
          expect(crossOwnerRead.structuredContent).toEqual({
            error: { code: 'not_found', message: 'External record not found.' },
          });
        },
      });

      await withExternalRecordClient({
        ownerId: OWNER_A,
        recordsService: service,
        run: async (client) => {
          const crossOwnerRead = await client.callTool({
            name: 'read_external_record',
            arguments: { address: ownerBAddress },
          });
          expect(crossOwnerRead.isError).toBe(true);
          expect(crossOwnerRead.structuredContent).toEqual({
            error: { code: 'not_found', message: 'External record not found.' },
          });
        },
      });

      await accept({
        service,
        syncId: SYNC_A_ID,
        ownerId: OWNER_A,
        batchId: 'batch-owner-a-delete',
        records: [
          record({
            eventId: 'event-owner-a-delete',
            recordId: 'owner-a-first',
            revision: 2,
            operation: 'deleted',
          }),
        ],
      });
      await withExternalRecordClient({
        ownerId: OWNER_A,
        recordsService: service,
        run: async (client) => {
          const deletedRead = await client.callTool({
            name: 'read_external_record',
            arguments: { address: firstAddress },
          });
          expect(deletedRead.isError).toBe(true);
          expect(deletedRead.structuredContent).toEqual({
            error: { code: 'not_found', message: 'External record not found.' },
          });

          const search = successfulResult<{ items: Array<{ recordId: string }> }>(
            await client.callTool({
              name: 'search_external_records',
              arguments: { query: 'sharedneedle', limit: 10 },
            }),
          );
          expect(search.items.map(({ recordId }) => recordId)).toEqual(['owner-a-second']);
        },
      });
    },
  });
});
