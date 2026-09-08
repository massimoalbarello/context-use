import { expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import type { SQL } from 'bun';
import type { McpClientAuthorizationPrincipal } from '#models/mcp-client-authorizations/model.ts';
import type {
  OpenConnectorDeliveryEnvelope,
  OpenConnectorDeliveryRecord,
} from '#models/open-connector/model.ts';
import { OpenConnectorRecordsRepository } from '#repositories/open-connector/repository.ts';
import { ExternalRecordAddressSchema, externalRecordIdentity } from '#routes/mcp/coordinates.ts';
import { registerExternalRecordTools } from '#routes/mcp/external-records/tools.ts';
import { OpenConnectorRecordsService } from '#services/open-connector/service.ts';
import { OpenConnectorIngestionWorker } from '#services/open-connector/worker.ts';
import { withAuthTestDatabase } from '../../lib/auth/auth-test-database.ts';

const OWNER_A = 'external-record-owner-a';
const OWNER_B = 'external-record-owner-b';
const INTEGRATION_A = 'receiver-a';
const INTEGRATION_A_SECOND = 'receiver-a-second';
const INTEGRATION_B = 'receiver-b';
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
}): OpenConnectorDeliveryRecord {
  return {
    eventId,
    provider: 'github',
    sourceId: 'github-account',
    kind: 'pull-request',
    id: recordId,
    revision,
    operation,
    contentHash: digest(body ?? 'deleted'),
    committedAt: NOW,
    ...(operation === 'deleted'
      ? {}
      : {
          content: {
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
          },
        }),
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

async function withExternalRecordClient<T>({
  ownerId,
  recordsService,
  run,
}: {
  ownerId: string;
  recordsService: OpenConnectorRecordsService;
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
  integrationId,
  ownerId,
  batchId,
  records,
}: {
  service: OpenConnectorRecordsService;
  integrationId: string;
  ownerId: string;
  batchId: string;
  records: OpenConnectorDeliveryRecord[];
}): Promise<void> {
  const envelope: OpenConnectorDeliveryEnvelope = { version: 1, batchId, records };
  expect(
    await service.accept({
      integrationId,
      ownerId,
      envelope,
      payloadHash: digest(JSON.stringify(envelope)),
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
      const repository = new OpenConnectorRecordsRepository(database);
      const ownerRegistration = {
        state: async () => ({ ownerExists: true, passkeyExists: true }),
      };
      const service = new OpenConnectorRecordsService({
        records: repository,
        ownerRegistration,
        now: () => new Date(NOW),
      });
      const worker = new OpenConnectorIngestionWorker({
        records: repository,
        now: () => new Date(NOW),
        leaseToken: () => Bun.randomUUIDv7(),
      });

      for (const [integrationId, ownerId] of [
        [INTEGRATION_A, OWNER_A],
        [INTEGRATION_A_SECOND, OWNER_A],
        [INTEGRATION_B, OWNER_B],
      ] as const) {
        expect(
          await repository.bindIntegration({ integrationId, ownerId, createdAt: NOW }),
        ).toEqual({
          state: 'bound',
        });
      }
      await accept({
        service,
        integrationId: INTEGRATION_A,
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
        integrationId: INTEGRATION_A_SECOND,
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
        integrationId: INTEGRATION_B,
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
      expect(await worker.tick()).toBe('completed');
      expect(await worker.tick()).toBe('completed');
      expect(await worker.tick()).toBe('completed');

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
            integrationId: INTEGRATION_A,
            sourceId: 'github-account',
            kind: 'pull-request',
            recordId: 'owner-a-first',
          });
          const unknownVersionAddress = `context-use://external-record/${Buffer.from(
            JSON.stringify([2, INTEGRATION_A, 'github-account', 'pull-request', 'owner-a-first']),
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
              sourceCreatedAt: string;
              attributes: Record<string, unknown>;
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
              sourceCreatedAt: '2026-09-01T08:00:00.123456Z',
              attributes: { repository: 'octo/example', number: 42, draft: false },
            },
          });
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
        integrationId: INTEGRATION_A,
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
      expect(await worker.tick()).toBe('completed');

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
