import { expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { OWNER_SYNTHETIC_EMAIL, OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { elysiaErrorHandler } from '#backend/lib/errors.ts';
import { createLocalStorage } from '#backend/lib/storage/client.ts';
import type { RecordDeletion, RecordInput } from '#backend/models/records/model.ts';
import { KnowledgePagesRepository } from '#backend/repositories/knowledge-pages/repository.ts';
import { RecordsRepository } from '#backend/repositories/records/repository.ts';
import { createPageReadableIdController } from '#backend/routes/api/pages/[pageReadableId]/controller.ts';
import { createPagesController } from '#backend/routes/api/pages/controller.ts';
import { createRecordReadableIdController } from '#backend/routes/api/records/[recordReadableId]/controller.ts';
import { createRecordsController } from '#backend/routes/api/records/controller.ts';
import { McpKnowledgePageSchema, mcpKnowledgePage } from '#backend/routes/mcp/pages/model.ts';
import { KnowledgePagesService } from '#backend/services/knowledge-pages/service.ts';
import { RecordsService } from '#backend/services/records/service.ts';
import { withRecordTestDatabase } from '../../repositories/records/database.ts';
import { unusedMcpProtection } from '../../support/mcp.ts';

const MILLISECONDS_PER_SECOND = 1000;
const NOW = '2026-09-09T09:00:00.000Z';
const OTHER_OWNER_ID = 'records-other-owner';

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
    passkeyOrigins: [],
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
  id,
  body,
  revision = 1,
}: {
  id: string;
  body?: string;
  revision?: number;
}): RecordInput | RecordDeletion {
  const source = { provider: 'github', kind: 'pull-request', id };
  const sourceUpdatedAt = new Date(
    Date.parse(NOW) + revision * MILLISECONDS_PER_SECOND,
  ).toISOString();
  return body === undefined
    ? { source, sourceUpdatedAt }
    : { source, sourceUpdatedAt, title: 'Pull request', body };
}
async function writeRecords({
  service,
  ownerId,
  records,
}: {
  service: RecordsService;
  ownerId: string;
  records: (RecordInput | RecordDeletion)[];
}) {
  for (const value of records) {
    const result =
      'body' in value
        ? await service.upsert({ ownerId, record: value })
        : await service.remove({ ownerId, ...value });
    expect(['created', 'updated']).toContain(result.state);
  }
}

test('record browsing exposes native metadata, applies filters, and hides another owner’s records', async () => {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      for (const ownerId of [OWNER_USER_ID, OTHER_OWNER_ID]) {
        await insertOwner({ database, ownerId });
      }
      const service = new RecordsService({
        records: new RecordsRepository(database),
        storage: createLocalStorage({ dataFolder }),
      });
      const own = await service.upsert({
        ownerId: OWNER_USER_ID,
        record: {
          source: {
            provider: 'github',
            kind: 'pull-request',
            id: '1',
            url: 'https://github.com/example/project/pull/1',
          },
          title: 'A title',
          body: '# Source body',
          occurredAt: NOW,
        },
      });
      const other = await service.upsert({
        ownerId: OTHER_OWNER_ID,
        record: {
          source: { provider: 'github', kind: 'pull-request', id: '2' },
          title: 'Private',
          body: 'Secret',
        },
      });
      const app = new Elysia({ prefix: '/api' })
        .use(createRecordsController({ auth: ownerAuth(), recordsService: service }))
        .use(createRecordReadableIdController({ auth: ownerAuth(), recordsService: service }));
      const get = (path: string) => app.handle(new Request(`http://localhost/api/records${path}`));
      const list = await (await get('')).json();
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({
        readableId: own.readableId,
        source: { provider: 'github', kind: 'pull-request', id: '1' },
        occurredAt: NOW,
      });
      expect(list.items[0]).not.toHaveProperty('body');
      const detail = await (await get(`/${own.readableId}`)).json();
      expect(detail).toMatchObject({
        title: 'A title',
        body: '# Source body',
        occurredAt: NOW,
        backlinks: [],
      });
      expect(detail).not.toHaveProperty('sync');
      expect(detail).not.toHaveProperty('participants');
      expect((await get(`/${other.readableId}`)).status).toBe(StatusMap['Not Found']);
      expect(await (await get('?provider=missing')).json()).toMatchObject({ items: [] });
      expect(await (await get('/filter-options')).json()).toEqual({
        providers: ['github'],
        kinds: ['pull-request'],
      });
      for (const query of [
        'sortBy=body',
        'sortDirection=sideways',
        'updatedFrom=invalid',
        'createdFrom=2026-02-01&createdTo=2026-01-01',
      ]) {
        const response = await get(`?${query}`);
        expect(response.status).toBeGreaterThanOrEqual(StatusMap['Bad Request']);
        expect(response.status).toBeLessThan(StatusMap['Internal Server Error']);
      }
      const unauthenticated = new Elysia({ prefix: '/api' }).onError(elysiaErrorHandler).use(
        createRecordsController({
          auth: { ...ownerAuth(), getSession: async () => null },
          recordsService: service,
        }),
      );
      expect(
        (await unauthenticated.handle(new Request('http://localhost/api/records'))).status,
      ).toBe(StatusMap.Unauthorized);
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
      for (const ownerId of [OWNER_USER_ID, OTHER_OWNER_ID]) {
        await insertOwner({ database, ownerId });
        await writeRecords({
          service: records,
          ownerId,
          records: [
            record({
              id: ownerId === OWNER_USER_ID ? 'source' : 'foreign-source',
              body: 'Evidence from the source.',
            }),
          ],
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
      await writeRecords({
        service: records,
        ownerId: OWNER_USER_ID,
        records: [record({ id: 'source', revision: 2 })],
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
      await writeRecords({
        service: records,
        ownerId: OWNER_USER_ID,
        records: [record({ id: 'source', revision: 3, body: 'Updated source.' })],
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
