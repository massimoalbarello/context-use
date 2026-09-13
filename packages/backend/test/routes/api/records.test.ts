import { expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { OWNER_SYNTHETIC_EMAIL, OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import { createLocalStorage } from '#lib/storage/client.ts';
import type { DeliveredRecord } from '#models/records/delivery-contract.generated.ts';
import { KnowledgePagesRepository } from '#repositories/knowledge-pages/repository.ts';
import { RecordsRepository } from '#repositories/records/repository.ts';
import { createPageReadableIdController } from '#routes/api/pages/[pageReadableId]/controller.ts';
import { createPagesController } from '#routes/api/pages/controller.ts';
import { createRecordReadableIdController } from '#routes/api/records/[recordReadableId]/controller.ts';
import { createRecordsController } from '#routes/api/records/controller.ts';
import { McpKnowledgePageSchema, mcpKnowledgePage } from '#routes/mcp/pages/model.ts';
import { KnowledgePagesService } from '#services/knowledge-pages/service.ts';
import { RecordsService } from '#services/records/service.ts';
import { withRecordTestDatabase } from '../../repositories/records/database.ts';
import { unusedMcpProtection } from '../../support/mcp.ts';

const UUID_SUFFIX_LENGTH = 12;
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
    eventId: `00000000-0000-4000-8000-${digest(eventId).slice(-UUID_SUFFIX_LENGTH)}`,
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
    title: 'example/repository #1: Improve records',
    body: body!,
    sourceUrl: `https://github.example/pulls/${id}`,
    attributes: { ignoredForNow: true },
    participants: [' Samantha Wells ', 'Samantha Wells', 'Alex Rivera'].map((name) => ({
      name,
      identities: [],
      roles: [],
    })),
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
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      const storage = createLocalStorage({ dataFolder });
      await insertOwner({ database, ownerId: OWNER_USER_ID });
      await insertOwner({ database, ownerId: OTHER_OWNER_ID });
      const repository = new RecordsRepository(database);
      const service = new RecordsService({
        records: repository,
        storage,
        now: () => new Date(NOW),
      });
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
          kind: 'pull-request',
          recordId: 'visible',
          title: 'example/repository #1: Improve records',
          provider: 'github',
          sourceCreatedAt: null,
          sourceUpdatedAt: null,
          sync: { readableId: 'github-sync', name: 'Engineering GitHub' },
        }),
      );
      expect(JSON.stringify(list)).not.toContain('hidden title');
      expect(JSON.stringify(list)).not.toContain('Other owner');
      expect(visible).not.toHaveProperty('participantNames');

      const filterOptions = await app.handle(
        new Request('http://localhost/api/records/filter-options'),
      );
      expect(filterOptions.status).toBe(StatusMap.OK);
      expect(await filterOptions.json()).toEqual({
        providers: ['github'],
        kinds: ['pull-request'],
      });

      const matching = await app.handle(
        new Request(
          'http://localhost/api/records?provider=github&kind=pull-request&sortBy=sourceCreatedAt&sortDirection=asc&limit=1',
        ),
      );
      expect(matching.status).toBe(StatusMap.OK);
      expect(await matching.json()).toMatchObject({ items: [expect.any(Object)] });
      const filtered = await app.handle(
        new Request('http://localhost/api/records?provider=other-provider'),
      );
      expect(await filtered.json()).toMatchObject({
        items: [],
        nextOffset: null,
        filterOptions: { providers: ['github'], kinds: ['pull-request'] },
      });
      for (const query of [
        'sortBy=body',
        'sortBy=provider',
        'sortBy=kind',
        'sortDirection=sideways',
        'updatedFrom=invalid',
        'createdFrom=2026-02-01&createdTo=2026-01-01',
      ]) {
        const invalid = await app.handle(new Request(`http://localhost/api/records?${query}`));
        expect(invalid.status).toBeGreaterThanOrEqual(StatusMap['Bad Request']);
        expect(invalid.status).toBeLessThan(StatusMap['Internal Server Error']);
      }

      const detailResponse = await app.handle(
        new Request(`http://localhost/api/records/${visible!.readableId}`),
      );
      expect(detailResponse.status).toBe(StatusMap.OK);
      const detail = (await detailResponse.json()) as Record<string, unknown>;
      expect(detail).toEqual(
        expect.objectContaining({
          readableId: visible!.readableId,
          kind: 'pull-request',
          recordId: 'visible',
          markdown,
          participantNames: ['Samantha Wells', 'Alex Rivera'],
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

test('pages reference owner records across revisions, source deletion and archival', async () => {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      const storage = createLocalStorage({ dataFolder });
      const records = new RecordsService({ records: new RecordsRepository(database), storage });
      const pages = new KnowledgePagesService({
        pages: new KnowledgePagesRepository(database),
        storage,
      });
      for (const [ownerId, syncId] of [
        [OWNER_USER_ID, OWNER_SYNC_ID],
        [OTHER_OWNER_ID, OTHER_SYNC_ID],
      ] as const) {
        await insertOwner({ database, ownerId });
        await insertSync({
          database,
          ownerId,
          id: syncId,
          readableId: 'source-sync',
          name: 'Source sync',
        });
        await accept({
          service: records,
          ownerId,
          syncId,
          batchId: ownerId,
          records: [record({ eventId: ownerId, id: 'source', body: 'Evidence from the source.' })],
        });
      }
      const own = (await records.listResources({ ownerId: OWNER_USER_ID, limit: 1, offset: 0 }))
        .items[0]!;
      const foreign = (
        await records.listResources({ ownerId: OTHER_OWNER_ID, limit: 1, offset: 0 })
      ).items[0]!;
      const auth = ownerAuth();
      const app = new Elysia({ prefix: '/api' })
        .use(createPagesController({ auth, pagesService: pages }))
        .use(createPageReadableIdController({ auth, pagesService: pages }))
        .use(createRecordsController({ auth, recordsService: records }))
        .use(createRecordReadableIdController({ auth, recordsService: records }));
      const request = ({ method, path, body }: { method: string; path: string; body?: unknown }) =>
        app.handle(
          new Request(`http://localhost/api${path}`, {
            method,
            headers: { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        );
      const markdown = `# Source account\n\n[Source](context-use://record/${own.readableId}) and [source again](context-use://record/${own.readableId}).`;
      const created = await request({ method: 'POST', path: '/pages', body: { markdown } });
      expect(created.status).toBe(StatusMap.Created);
      expect(await created.json()).toMatchObject({
        recordReferences: [{ readableId: own.readableId, available: true, title: own.title }],
      });
      const detail = await records.findResource({
        ownerId: OWNER_USER_ID,
        readableId: own.readableId,
      });
      expect(detail?.backlinks.map((page) => page.readableId)).toEqual(['source-account']);
      const page = (await pages.detail({ ownerId: OWNER_USER_ID, readableId: 'source-account' }))!;
      const mcp = McpKnowledgePageSchema.parse(mcpKnowledgePage(page));
      expect(mcp.recordReferences).toMatchObject([
        { address: `context-use://record/${own.readableId}`, available: true },
      ]);
      for (const target of [foreign.readableId, 'missing-record']) {
        const rejected = await request({
          method: 'POST',
          path: '/pages',
          body: {
            markdown: `# Invalid target\n\n[Source](context-use://record/${target})`,
          },
        });
        expect(rejected.status).toBe(StatusMap['Bad Request']);
        expect(await rejected.json()).toEqual({ error: `Link target not found: record/${target}` });
      }
      expect(
        await pages.detail({ ownerId: OWNER_USER_ID, readableId: 'invalid-target' }),
      ).toBeNull();
      const failedUpdate = await request({
        method: 'PUT',
        path: '/pages/source-account',
        body: {
          expectedRevisionNumber: 1,
          markdown: `# Source account\n\n[Foreign](context-use://record/${foreign.readableId})`,
        },
      });
      expect(failedUpdate.status).toBe(StatusMap['Bad Request']);
      expect(
        (await pages.detail({ ownerId: OWNER_USER_ID, readableId: 'source-account' }))
          ?.revisionNumber,
      ).toBe(1);
      expect(
        (await records.findResource({ ownerId: OWNER_USER_ID, readableId: own.readableId }))
          ?.backlinks,
      ).toHaveLength(1);
      await accept({
        service: records,
        ownerId: OWNER_USER_ID,
        syncId: OWNER_SYNC_ID,
        batchId: 'delete-source',
        records: [
          record({ eventId: 'delete-source', id: 'source', revision: 2, operation: 'deleted' }),
        ],
      });
      expect((await request({ method: 'GET', path: `/records/${own.readableId}` })).status).toBe(
        StatusMap['Not Found'],
      );
      expect(
        await (await request({ method: 'GET', path: '/pages/source-account' })).json(),
      ).toMatchObject({
        recordReferences: [{ readableId: own.readableId, available: false }],
      });
      expect(
        await (await request({ method: 'GET', path: '/pages/source-account/preview' })).json(),
      ).toMatchObject({
        recordReferences: [{ readableId: own.readableId, available: false }],
      });
      const newlyDeleted = await request({
        method: 'POST',
        path: '/pages',
        body: {
          markdown: markdown.replace('Source account', 'New account'),
        },
      });
      expect(newlyDeleted.status).toBe(StatusMap['Bad Request']);
      const edited = await request({
        method: 'PUT',
        path: '/pages/source-account',
        body: {
          expectedRevisionNumber: 1,
          markdown: `${markdown} Still useful.`,
        },
      });
      expect(edited.status).toBe(StatusMap.OK);
      expect(
        (await pages.detail({ ownerId: OWNER_USER_ID, readableId: 'source-account' }))
          ?.recordReferences,
      ).toMatchObject([{ available: false }]);
      await accept({
        service: records,
        ownerId: OWNER_USER_ID,
        syncId: OWNER_SYNC_ID,
        batchId: 'restore-source',
        records: [
          record({ eventId: 'restore-source', id: 'source', revision: 3, body: 'Updated source.' }),
        ],
      });
      expect(
        (await records.findResource({ ownerId: OWNER_USER_ID, readableId: own.readableId }))
          ?.backlinks,
      ).toHaveLength(1);
      const removed = await request({
        method: 'PUT',
        path: '/pages/source-account',
        body: {
          expectedRevisionNumber: 2,
          markdown: '# Source account\n\nThe source is no longer relevant.',
        },
      });
      expect(removed.status).toBe(StatusMap.OK);
      expect(
        (await records.findResource({ ownerId: OWNER_USER_ID, readableId: own.readableId }))
          ?.backlinks,
      ).toEqual([]);
      expect(
        (
          await request({
            method: 'PUT',
            path: '/pages/source-account',
            body: { expectedRevisionNumber: 3, markdown },
          })
        ).status,
      ).toBe(StatusMap.OK);
      expect((await request({ method: 'PUT', path: '/pages/source-account/archive' })).status).toBe(
        StatusMap['No Content'],
      );
      expect(
        (await records.findResource({ ownerId: OWNER_USER_ID, readableId: own.readableId }))
          ?.backlinks,
      ).toEqual([]);
      const remaining =
        await database`select * from "knowledge_page_record_reference" where "owner_id" = ${OWNER_USER_ID}`;
      expect(remaining).toHaveLength(0);
    },
  });
});
