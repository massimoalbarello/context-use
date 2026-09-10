import { expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { OWNER_SYNTHETIC_EMAIL, OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import type { DeliveredRecord } from '#models/records/delivery-contract.generated.ts';
import { RecordsRepository } from '#repositories/records/repository.ts';
import { createRecordReadableIdController } from '#routes/api/records/[recordReadableId]/controller.ts';
import { createRecordsController } from '#routes/api/records/controller.ts';
import { RecordsService } from '#services/records/service.ts';
import { withAuthTestDatabase } from '../../lib/auth/auth-test-database.ts';
import { unusedMcpProtection } from '../../support/mcp.ts';

const NOW = '2026-09-09T09:00:00.000Z';
const OTHER_OWNER_ID = 'records-other-owner';
const OWNER_SYNC_ID = '01991f43-0c00-7000-8000-000000000020';
const OTHER_SYNC_ID = '01991f43-0c00-7000-8000-000000000021';

function digest(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

async function insertOwner({ database, ownerId }: { database: SQL; ownerId: string }) {
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
  name,
}: {
  database: SQL;
  id: string;
  ownerId: string;
  readableId: string;
  name: string;
}) {
  await database`
    insert into "record_sync"
      ("id", "owner_id", "readable_id", "name", "api_key_sha256", "created_at")
    values (${id}, ${ownerId}, ${readableId}, ${name}, ${digest(`${id}-key`)}, ${NOW})
  `;
}

function ownerAuth(): Auth {
  const timestamp = new Date(NOW);
  return {
    handler: async () => new Response(null, { status: StatusMap['Not Found'] }),
    getSession: async () => ({
      user: {
        id: OWNER_USER_ID,
        name: 'Owner',
        email: OWNER_SYNTHETIC_EMAIL,
        emailVerified: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      session: {
        id: 'session-id',
        userId: OWNER_USER_ID,
        token: 'session-token',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    }),
    protectMcpRequest: unusedMcpProtection,
  };
}

function record({
  eventId,
  id,
  body,
  revision = 1,
  operation = revision === 1 ? 'added' : 'updated',
}: {
  eventId: string;
  id: string;
  body?: string;
  revision?: number;
  operation?: 'added' | 'updated' | 'deleted';
}): DeliveredRecord {
  const common = {
    eventId,
    provider: 'github',
    sourceId: 'github.example',
    kind: 'pull-request',
    id,
    revision,
    committedAt: NOW,
  };
  if (operation === 'deleted') {
    return { ...common, operation, contentHash: digest('deleted') };
  }
  const content = {
    body: body!,
    sourceUrl: `https://github.example/pulls/${id}`,
    attributes: { ignoredForNow: true },
  };
  return {
    ...common,
    operation,
    contentHash: digest(JSON.stringify(content)),
    content,
  };
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
}) {
  expect(
    await service.accept({
      syncId,
      ownerId,
      envelope: { version: 1, batchId, records },
    }),
  ).toEqual({ state: 'accepted' });
}

test('record API lists active owner records and returns Markdown detail with sync provenance', async () => {
  await withAuthTestDatabase({
    run: async (database) => {
      await insertOwner({ database, ownerId: OWNER_USER_ID });
      await insertOwner({ database, ownerId: OTHER_OWNER_ID });
      const repository = new RecordsRepository(database);
      const service = new RecordsService({ records: repository, now: () => new Date(NOW) });
      await insertSync({
        database,
        id: OWNER_SYNC_ID,
        ownerId: OWNER_USER_ID,
        readableId: 'github-sync',
        name: 'Engineering GitHub',
      });
      await insertSync({
        database,
        id: OTHER_SYNC_ID,
        ownerId: OTHER_OWNER_ID,
        readableId: 'other-sync',
        name: 'Other owner service',
      });

      const markdown = [
        '<script>hidden title</script>',
        '',
        '[reference]: https://example.invalid',
        '',
        '![Architecture diagram](https://example.invalid/diagram.png)',
        '',
        '# Linked title',
        '',
        '[Read the discussion](https://example.invalid/discussion)',
      ].join('\n');
      await accept({
        service,
        syncId: OWNER_SYNC_ID,
        ownerId: OWNER_USER_ID,
        batchId: 'owner-batch',
        records: [
          record({ eventId: 'visible-event', id: 'visible', body: markdown }),
          record({ eventId: 'second-event', id: 'second', body: '# Second\n\nSecond excerpt.' }),
          record({
            eventId: 'deleted-event',
            id: 'deleted',
            revision: 2,
            operation: 'deleted',
          }),
        ],
      });
      await accept({
        service,
        syncId: OTHER_SYNC_ID,
        ownerId: OTHER_OWNER_ID,
        batchId: 'other-batch',
        records: [record({ eventId: 'other-event', id: 'other', body: '# Other owner' })],
      });
      const otherOwnerPage = await service.listResources({
        ownerId: OTHER_OWNER_ID,
        limit: 1,
        offset: 0,
      });
      expect(otherOwnerPage.items).toHaveLength(1);

      const app = new Elysia({ prefix: '/api' })
        .use(createRecordsController({ auth: ownerAuth(), recordsService: service }))
        .use(createRecordReadableIdController({ auth: ownerAuth(), recordsService: service }));
      const firstPageResponse = await app.handle(
        new Request('http://localhost/api/records?limit=1&offset=0'),
      );
      expect(firstPageResponse.status).toBe(StatusMap.OK);
      const firstPage = (await firstPageResponse.json()) as {
        items: Array<Record<string, unknown>>;
        nextOffset: number | null;
      };
      expect(firstPage.items).toHaveLength(1);
      expect(firstPage.nextOffset).toBe(1);

      const listResponse = await app.handle(new Request('http://localhost/api/records'));
      expect(listResponse.status).toBe(StatusMap.OK);
      const list = (await listResponse.json()) as {
        items: Array<{
          readableId: string;
          sourceId: string;
          kind: string;
          recordId: string;
          sync: { readableId: string; name: string };
        }>;
        nextOffset: number | null;
      };
      expect(list.items).toHaveLength(2);
      const visible = list.items.find(({ recordId }) => recordId === 'visible');
      expect(visible).toEqual(
        expect.objectContaining({
          readableId: expect.stringMatching(/^pull-request-visible-[a-f0-9]{24}$/),
          sourceId: 'github.example',
          kind: 'pull-request',
          recordId: 'visible',
          sync: { readableId: 'github-sync', name: 'Engineering GitHub' },
        }),
      );
      expect(JSON.stringify(list)).not.toContain('hidden title');
      expect(JSON.stringify(list)).not.toContain('Other owner');

      const detailResponse = await app.handle(
        new Request(`http://localhost/api/records/${visible!.readableId}`),
      );
      expect(detailResponse.status).toBe(StatusMap.OK);
      const detail = (await detailResponse.json()) as Record<string, unknown>;
      expect(detail).toEqual(
        expect.objectContaining({
          readableId: visible!.readableId,
          sourceId: 'github.example',
          kind: 'pull-request',
          recordId: 'visible',
          markdown,
          sync: { readableId: 'github-sync', name: 'Engineering GitHub' },
        }),
      );
      expect(detail).not.toHaveProperty('sourceUrl');
      expect(detail).not.toHaveProperty('attributes');
      expect(
        (
          await app.handle(
            new Request(`http://localhost/api/records/${otherOwnerPage.items[0]!.readableId}`),
          )
        ).status,
      ).toBe(StatusMap['Not Found']);

      await accept({
        service,
        syncId: OWNER_SYNC_ID,
        ownerId: OWNER_USER_ID,
        batchId: 'renamed-batch',
        records: [
          record({
            eventId: 'renamed-event',
            id: 'visible',
            revision: 2,
            body: '# Renamed title\n\nA replacement excerpt.',
          }),
        ],
      });
      const renamedResponse = await app.handle(
        new Request(`http://localhost/api/records/${visible!.readableId}`),
      );
      expect(renamedResponse.status).toBe(StatusMap.OK);
      expect(await renamedResponse.json()).toEqual(
        expect.objectContaining({
          readableId: visible!.readableId,
          sourceId: 'github.example',
          kind: 'pull-request',
          recordId: 'visible',
          markdown: '# Renamed title\n\nA replacement excerpt.',
        }),
      );

      await database`
        update "record_sync" set "revoked_at" = ${NOW} where "id" = ${OWNER_SYNC_ID}
      `;
      expect(
        (await app.handle(new Request(`http://localhost/api/records/${visible!.readableId}`)))
          .status,
      ).toBe(StatusMap.OK);
      expect(
        await service.accept({
          syncId: OWNER_SYNC_ID,
          ownerId: OWNER_USER_ID,
          envelope: {
            version: 1,
            batchId: 'revoked-sync-batch',
            records: [
              record({
                eventId: 'revoked-sync-event',
                id: 'visible',
                revision: 3,
                body: '# Must not replace the retained record',
              }),
            ],
          },
        }),
      ).toEqual({ state: 'inactive_sync' });
      expect(
        (await app.handle(new Request('http://localhost/api/records/does-not-exist'))).status,
      ).toBe(StatusMap['Not Found']);
    },
  });
});
