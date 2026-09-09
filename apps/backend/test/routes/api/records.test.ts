import { expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { OWNER_SYNTHETIC_EMAIL, OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import type { OpenConnectorDeliveryRecord } from '#models/open-connector/model.ts';
import { canonicalOpenConnectorContent } from '#models/open-connector/model.ts';
import { OpenConnectorRecordsRepository } from '#repositories/open-connector/repository.ts';
import { createRecordReadableIdController } from '#routes/api/records/[recordReadableId]/controller.ts';
import { createRecordsController } from '#routes/api/records/controller.ts';
import { OpenConnectorRecordsService } from '#services/open-connector/service.ts';
import { withAuthTestDatabase } from '../../lib/auth/auth-test-database.ts';
import { unusedMcpProtection } from '../../support/mcp.ts';

const NOW = '2026-09-09T09:00:00.000Z';
const OTHER_OWNER_ID = 'records-other-owner';

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
}): OpenConnectorDeliveryRecord {
  const content =
    operation === 'deleted'
      ? undefined
      : {
          body: body!,
          sourceUrl: `https://github.example/pulls/${id}`,
          attributes: { ignoredForNow: true },
        };
  return {
    eventId,
    provider: 'github',
    sourceId: 'github.example',
    kind: 'pull-request',
    id,
    revision,
    operation,
    contentHash: content ? digest(canonicalOpenConnectorContent(content)!) : digest('deleted'),
    committedAt: NOW,
    ...(content ? { content } : {}),
  };
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
}) {
  expect(
    await service.accept({
      integrationId,
      ownerId,
      envelope: { version: 1, batchId, records },
      payloadHash: digest(batchId),
    }),
  ).toEqual({ state: 'accepted' });
}

test('record API lists active owner records and returns Markdown detail with service provenance', async () => {
  await withAuthTestDatabase({
    run: async (database) => {
      await insertOwner({ database, ownerId: OWNER_USER_ID });
      await insertOwner({ database, ownerId: OTHER_OWNER_ID });
      const repository = new OpenConnectorRecordsRepository(database);
      const service = new OpenConnectorRecordsService({
        records: repository,
        ownerRegistration: {
          state: async () => ({ ownerExists: true, passkeyExists: true }),
        },
        now: () => new Date(NOW),
      });
      expect(
        await service.bindIntegration({
          integrationId: 'github-sync',
          ownerId: OWNER_USER_ID,
          name: 'Engineering GitHub',
        }),
      ).toEqual({ state: 'bound' });
      expect(
        await repository.bindIntegration({
          integrationId: 'other-sync',
          ownerId: OTHER_OWNER_ID,
          name: 'Other owner service',
          createdAt: NOW,
        }),
      ).toEqual({ state: 'bound' });

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
        integrationId: 'github-sync',
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
        integrationId: 'other-sync',
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
          title: string;
          excerpt: string;
          externalService: { id: string; name: string };
        }>;
        nextOffset: number | null;
      };
      expect(list.items).toHaveLength(2);
      const visible = list.items.find(({ title }) => title === 'Linked title');
      expect(visible).toEqual(
        expect.objectContaining({
          readableId: expect.stringMatching(/^linked-title-[a-f0-9]{24}$/),
          title: 'Linked title',
          excerpt: 'Architecture diagram',
          externalService: { id: 'github-sync', name: 'Engineering GitHub' },
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
          title: 'Linked title',
          excerpt: 'Architecture diagram',
          markdown,
          externalService: { id: 'github-sync', name: 'Engineering GitHub' },
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
        integrationId: 'github-sync',
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
          title: 'Renamed title',
          excerpt: 'A replacement excerpt.',
          markdown: '# Renamed title\n\nA replacement excerpt.',
        }),
      );
      expect(
        (await app.handle(new Request('http://localhost/api/records/does-not-exist'))).status,
      ).toBe(StatusMap['Not Found']);
    },
  });
});
