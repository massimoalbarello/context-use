import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Elysia, type Static, StatusMap } from 'elysia';
import {
  createSqliteDatabase,
  createSqliteReader,
  createSynchronousSqliteReader,
} from '#backend/db/client.ts';
import { runMigrations } from '#backend/db/migrate.ts';
import { createAuth } from '#backend/lib/auth/better-auth.ts';
import { elysiaErrorHandler } from '#backend/lib/errors.ts';
import type { FaceAnalyzer } from '#backend/lib/face-analysis/analyzer.ts';
import { LOCAL_FACE_MODEL } from '#backend/lib/face-analysis/models.ts';
import { createLocalStorage } from '#backend/lib/storage/client.ts';
import { LocalStorage } from '#backend/lib/storage/local-storage.ts';
import type { AssetFaces } from '#backend/models/faces/model.ts';
import { KnowledgePagesRepository } from '#backend/repositories/knowledge-pages/repository.ts';
import type { MapPagesSchema } from '#backend/routes/api/map/model.ts';
import { MAX_LIST_LIMIT } from '#backend/routes/api/model.ts';
import { createPagesController } from '#backend/routes/api/pages/controller.ts';
import type {
  KnowledgePageListSchema,
  KnowledgePageSchema,
} from '#backend/routes/api/pages/model.ts';
import type { RecordListSchema, RecordSchema } from '#backend/routes/api/records/model.ts';
import { KnowledgePagesService } from '#backend/services/knowledge-pages/service.ts';
import { createDemoApp } from '../app';
import { DEMO_OWNER_ID } from '../identity';
import { readOnlyStorage } from '../read-only-storage';
import { createDemoResources } from '../resources';
import { seedDemoSnapshot } from '../seed';

const EXPECTED_PAGES = 61;
const EXPECTED_ENTITIES = 30;
const EXPECTED_PEOPLE = 11;
const EXPECTED_ORGANIZATIONS = 7;
const EXPECTED_UNTYPED_ENTITIES = 12;
const EXPECTED_RECORDS = 55;
const EXPECTED_PROVIDERS = 3;
const EXPECTED_ASSETS = 35;
const TEST_TIMEOUT_MS = 30_000;

const unavailableAnalyzer: FaceAnalyzer = {
  model: LOCAL_FACE_MODEL,
  status: async () => ({ state: 'ready', downloaded: true, error: null, checkedAt: null }),
  check: async () => {},
  analyze: () => Promise.reject(new Error('Demo inference unavailable')),
};

async function fixtureAnalyzer(): Promise<FaceAnalyzer> {
  const signatures = new Set<string>();
  const fixtures = resolve(import.meta.dir, '../fixtures/assets');
  const crop = new Blob([await Bun.file(join(fixtures, 'steve-jobs-2010.jpg')).bytes()], {
    type: 'image/jpeg',
  });
  for (const name of ['steve-jobs-2010.jpg', 'steve-presents-iphone.jpg']) {
    const file = Bun.file(join(fixtures, name));
    signatures.add(Bun.SHA256.hash(await file.arrayBuffer(), 'hex'));
  }
  return {
    ...unavailableAnalyzer,
    analyze: async ({ image }) => ({
      model: LOCAL_FACE_MODEL,
      faces: signatures.has(Bun.SHA256.hash(await image.arrayBuffer(), 'hex'))
        ? [
            {
              box: [0, 0, 1, 1],
              detectionScore: 1,
              embedding: [1, ...Array<number>(LOCAL_FACE_MODEL.dimensions - 1).fill(0)],
              crop,
            },
          ]
        : [],
    }),
  };
}

async function fingerprint(folder: string) {
  const hashes: Record<string, string> = {};
  for (const path of new Bun.Glob('**/*').scanSync({ cwd: folder, onlyFiles: true })) {
    hashes[path] = new Bun.CryptoHasher('sha256')
      .update(await Bun.file(join(folder, path)).arrayBuffer())
      .digest('hex');
  }
  return hashes;
}

test('the story is connected and each checkpoint cites only sources already available then', async () => {
  const fixtures = resolve(import.meta.dir, '../fixtures');
  const records: { source: { id: string }; sourceUpdatedAt: string }[] = await Bun.file(
    join(fixtures, 'records/index.json'),
  ).json();
  const snapshots: { readableId: string; path: string; asOf: string }[] = await Bun.file(
    join(fixtures, 'pages/index.json'),
  ).json();
  const recordDates = new Map(
    records.map(({ source, sourceUpdatedAt }) => [
      source.id,
      sourceUpdatedAt.slice(0, 'YYYY-MM-DD'.length),
    ]),
  );
  const latestLinks = new Map<string, string[]>();
  const citedRecords = new Set<string>();
  for (const snapshot of snapshots) {
    const markdown = await Bun.file(join(fixtures, snapshot.path)).text();
    const pageLinks = Array.from(
      markdown.matchAll(/context-use:\/\/page\/([a-z0-9-]+)/g),
      ([, id]) => id!,
    );
    for (const id of pageLinks) {
      expect(latestLinks.has(id), `${snapshot.path} refers to a page not yet created: ${id}`).toBe(
        true,
      );
    }
    latestLinks.set(snapshot.readableId, pageLinks);
    for (const [, id] of markdown.matchAll(/context-use:\/\/record\/([a-z0-9-]+)/g)) {
      const sourceDate = recordDates.get(id!);
      expect(sourceDate, `${snapshot.path} has an unresolved source: ${id}`).toBeDefined();
      expect(sourceDate! <= snapshot.asOf, `${snapshot.path} cites a future source: ${id}`).toBe(
        true,
      );
      citedRecords.add(id!);
    }
  }
  expect(citedRecords).toEqual(new Set(recordDates.keys()));

  const visited = new Set<string>();
  const pending = ['my-work-from-ipod-to-iphone'];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (visited.has(id)) {
      continue;
    }
    visited.add(id);
    pending.push(...latestLinks.get(id)!);
  }
  expect([...visited].sort()).toEqual([...latestLinks.keys()].sort());
});

test(
  'anonymous demo browsing and rejected requests leave the entire snapshot unchanged',
  async () => {
    const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-demo-test-'));
    try {
      await seedDemoSnapshot({ dataFolder, analyzer: await fixtureAnalyzer() });
      const database = createSqliteReader({ dataFolder });
      const facesDatabase = createSynchronousSqliteReader({ dataFolder });
      try {
        const storage = readOnlyStorage(createLocalStorage({ dataFolder }));
        const crops = readOnlyStorage(new LocalStorage(join(dataFolder, 'face-crops')));
        const resources = createDemoResources({
          database,
          facesDatabase,
          storage,
          crops,
          analyzer: unavailableAnalyzer,
        });
        const before = await fingerprint(dataFolder);
        const fetchDemo = createDemoApp({
          resources,
          frontendAssetsService: {
            routes: () => new Map([['/test.js', new Response('demo frontend')]]),
            fallback: () => new Response('<html>Demo</html>'),
          },
        });
        const read = (path: string) => fetchDemo(new Request(`http://demo.test${path}`));
        for (const [path, count] of [
          ['/api/pages?limit=50', MAX_LIST_LIMIT],
          ['/api/pages?limit=50&offset=50', EXPECTED_PAGES - MAX_LIST_LIMIT],
          ['/api/entities?limit=50', EXPECTED_ENTITIES],
          ['/api/entities?limit=50&entityType=person', EXPECTED_PEOPLE],
          ['/api/entities?limit=50&entityType=organization', EXPECTED_ORGANIZATIONS],
          ['/api/entities?limit=50&entityType=untyped', EXPECTED_UNTYPED_ENTITIES],
          ['/api/records?limit=50', MAX_LIST_LIMIT],
          ['/api/records?limit=50&offset=50', EXPECTED_RECORDS - MAX_LIST_LIMIT],
          ['/api/assets?limit=50', EXPECTED_ASSETS],
        ] as const) {
          const response = await read(path);
          expect(response.status).toBe(StatusMap.OK);
          expect(
            ((await response.json()) as Static<typeof KnowledgePageListSchema>).items,
          ).toHaveLength(count);
        }
        for (const path of [
          '/api/auth/get-session',
          '/api/profile',
          '/api/health',
          '/api/entities/steve-jobs',
          '/api/entities/steve-jobs/images',
          '/api/pages/my-work-from-ipod-to-iphone',
          '/api/pages/my-work-from-ipod-to-iphone/diff?from=0&to=1',
          '/api/pages/my-work-from-ipod-to-iphone/preview',
          '/api/assets/steve-presenting-iphone',
          '/api/assets/steve-presenting-iphone/content',
          '/api/assets/steve-presenting-iphone/faces',
          '/api/face-recognition/settings',
          '/api/face-recognition/processing',
          '/api/records/filter-options',
          '/api/map/pages',
          '/api/hypermedia/search?query=iPhone',
          '/map',
          '/pages/new',
          '/entities/new',
          '/assets/new',
          '/settings',
          '/settings/api-keys',
          '/settings/faces',
          '/test.js',
        ]) {
          const response = await read(path);
          expect(response.status, path).toBe(StatusMap.OK);
          expect(response.headers.has('set-cookie')).toBe(false);
          await response.arrayBuffer();
        }
        await assertPreviewFormats(read);
        // Prove the shared seed produces distinct, discoverable pages each month through
        // the public demo API, with no month-specific pages leaking into adjacent months.
        const seenPages = new Set<string>();
        for (let month = 1; month <= 10; month += 1) {
          const time = `2007-${String(month).padStart(2, '0')}`;
          const response = await read(`/api/map/pages?visible=steve-jobs&time=${time}`);
          expect(response.status).toBe(StatusMap.OK);
          const result = (await response.json()) as Static<typeof MapPagesSchema>;
          expect(result.nextOffset).toBeNull();
          const datedPages = result.pages.filter((page) => {
            const coverage = page.temporalCoverage;
            return coverage !== null && !coverage.includes('/');
          });
          expect(
            datedPages.length,
            `${time} should visibly change Steve's map`,
          ).toBeGreaterThanOrEqual(2);
          for (const page of datedPages) {
            expect(page.temporalCoverage?.startsWith(time)).toBe(true);
            expect(seenPages.has(page.readableId)).toBe(false);
            seenPages.add(page.readableId);
            expect(page.entities).toContainEqual({ readableId: 'steve-jobs' });
            expect((await read(`/api/pages/${page.readableId}`)).status).toBe(StatusMap.OK);
          }
        }
        const graphQuery = new URLSearchParams({
          anchors: JSON.stringify([
            { anchor: { readableId: 'steve-jobs' } },
            { anchor: { readableId: 'iphone' } },
          ]),
          limit: '2',
        });
        const graphPath = `/api/map/neighborhoods?${graphQuery}`;
        const graph = await read(graphPath);
        expect(graph.status).toBe(StatusMap.OK);
        expect(graph.headers.get('cache-control')).toBe('no-store');
        expect(graph.headers.has('set-cookie')).toBe(false);
        expect(await graph.json()).toMatchObject({
          entities: expect.arrayContaining([
            expect.objectContaining({ readableId: 'steve-jobs' }),
            expect.objectContaining({ readableId: 'iphone' }),
          ]),
          neighborhoods: [
            { anchor: { readableId: 'steve-jobs' }, available: true, neighbors: expect.any(Array) },
            { anchor: { readableId: 'iphone' }, available: true, neighbors: expect.any(Array) },
          ],
        });
        const graphHead = await fetchDemo(
          new Request(`http://demo.test${graphPath}`, { method: 'HEAD' }),
        );
        expect(graphHead.status).toBe(StatusMap.OK);
        expect(await graphHead.text()).toBe('');
        const invalidGraph = await read('/api/map/neighborhoods?anchors=[]');
        expect(invalidGraph.status).toBe(StatusMap['Bad Request']);
        const page = (await (
          await read('/api/pages/bringing-our-music-work-into-phones')
        ).json()) as Static<typeof KnowledgePageSchema>;
        const faces = (await (
          await read('/api/assets/steve-presenting-iphone/faces')
        ).json()) as AssetFaces;
        expect(faces).toMatchObject({
          state: 'ready',
          outdated: false,
          faces: [{ entity: { readableId: 'steve-jobs' }, decision: 'automatic' }],
        });
        const crop = await read(
          `/api/assets/steve-presenting-iphone/faces/${faces.faces[0]!.readableId}/crop`,
        );
        expect(crop.status).toBe(StatusMap.OK);
        expect(crop.headers.get('content-type')).toContain('image/jpeg');
        expect(await crop.arrayBuffer()).toEqual(
          await Bun.file(
            resolve(import.meta.dir, '../fixtures/assets/steve-jobs-2010.jpg'),
          ).arrayBuffer(),
        );
        expect(await (await read('/api/entities/steve-jobs/images')).json()).toMatchObject({
          items: expect.arrayContaining([
            expect.objectContaining({ readableId: 'steve-presenting-iphone' }),
            expect.objectContaining({ readableId: 'steve-jobs-portrait-2010' }),
          ]),
          nextOffset: null,
        });
        expect(await (await read('/api/assets/apple-company-mark/faces')).json()).toMatchObject({
          state: 'ready',
          faces: [],
        });
        expect(
          await (await read('/api/assets/synthetic-ipod-demo-checklist/faces')).json(),
        ).toMatchObject({ state: 'unsupported', faces: [] });
        expect(page.revisions.length).toBeGreaterThan(1);
        const comparison = await read(`/api/pages/${page.readableId}/diff?from=1&to=2`);
        expect(comparison.status).toBe(StatusMap.OK);
        expect(comparison.headers.get('cache-control')).toBe('no-store');
        expect(await comparison.json()).toMatchObject({
          from: 1,
          to: 2,
          hunks: expect.any(Array),
        });
        const records = (await (await read('/api/records?limit=50')).json()) as Static<
          typeof RecordListSchema
        >;
        expect(records.filterOptions).toEqual({
          providers: ['gmail', 'granola', 'slack'],
          kinds: ['meeting', 'thread'],
        });
        const providers = new Set<string>();
        for (const [provider, kind] of [
          ['gmail', 'thread'],
          ['slack', 'thread'],
          ['granola', 'meeting', 'Granola · Steve’s meetings'],
        ]) {
          const result = (await (
            await read(`/api/records?limit=50&provider=${provider}`)
          ).json()) as Static<typeof RecordListSchema>;
          expect(result.items.length).toBeGreaterThan(0);
          expect(result.nextOffset).toBeNull();
          for (const record of result.items) {
            expect(record).toMatchObject({ source: { provider, kind } });
            providers.add(record.source.provider);
            const detail = (await (
              await read(`/api/records/${record.readableId}`)
            ).json()) as Static<typeof RecordSchema>;
            expect(detail.backlinks.length, record.source.id).toBeGreaterThan(0);
          }
        }
        expect(providers.size).toBe(EXPECTED_PROVIDERS);

        // Follow one decision across services, then back to the explanation that cites it.
        const credit = (await (
          await read('/api/pages/responding-to-our-early-iphone-customers')
        ).json()) as Static<typeof KnowledgePageSchema>;
        expect(credit.references.map(({ page }) => page.readableId)).toEqual(
          expect.arrayContaining([
            'lowering-the-price-of-our-iphone',
            'introducing-the-phone-we-built',
            'completing-the-album',
          ]),
        );
        expect(credit.recordReferences).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ provider: 'gmail', available: true }),
            expect.objectContaining({ provider: 'slack', available: true }),
          ]),
        );
        for (const source of credit.recordReferences) {
          const detail = (await (await read(`/api/records/${source.readableId}`)).json()) as Static<
            typeof RecordSchema
          >;
          expect(detail.backlinks).toContainEqual(
            expect.objectContaining({ readableId: credit.readableId }),
          );
        }
        const sdk = (await (
          await read('/api/pages/committing-to-native-applications-for-iphone')
        ).json()) as Static<typeof KnowledgePageSchema>;
        expect(sdk.recordReferences.map(({ provider }) => provider).sort()).toEqual([
          'gmail',
          'granola',
          'slack',
        ]);
        expect(sdk.recordReferences.every(({ available }) => available)).toBe(true);
        expect(sdk.references).toContainEqual(
          expect.objectContaining({
            page: expect.objectContaining({ readableId: 'asking-developers-to-build-for-the-web' }),
          }),
        );
        const head = await fetchDemo(
          new Request('http://demo.test/api/profile', { method: 'HEAD' }),
        );
        expect(head.status).toBe(StatusMap.OK);
        expect(await head.text()).toBe('');
        // Try every mutation registered by the reused controllers, plus unmounted surfaces.
        const deniedPaths = [
          '/api/map/neighborhoods',
          '/api/pages',
          '/api/pages/my-work-from-ipod-to-iphone',
          '/api/pages/my-work-from-ipod-to-iphone/diff?from=0&to=1',
          '/api/pages/my-work-from-ipod-to-iphone/archive',
          '/api/entities',
          '/api/entities/steve-jobs',
          '/api/entities/steve-jobs/image',
          '/api/entities/steve-jobs/archive',
          '/api/assets',
          '/api/assets/steve-presenting-iphone',
          '/api/assets/steve-presenting-iphone/archive',
          '/api/assets/steve-presenting-iphone/faces/analyze',
          '/api/assets/steve-presenting-iphone/faces/face-test/annotation',
          '/api/face-recognition/settings',
          '/api/face-recognition/retry',
          '/api/face-recognition/model/check',
          '/api/profile',
          '/api/records',
          '/api/api-keys',
          '/api/api-keys/research/revoke',
          '/api/mcp/clients',
          '/api/auth/sign-out',
          '/api/auth/passkey/generate-register-options',
          '/api/owner-registration',
          '/mcp',
          '/mcp/asset-transfers/token',
          '/',
          '/test.js',
        ];
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
          for (const path of deniedPaths) {
            const response = await fetchDemo(
              new Request(`http://demo.test${path}`, {
                method,
                headers: { 'content-type': 'application/json', 'x-http-method-override': 'GET' },
                body: '{}',
              }),
            );
            expect(response.status, `${method} ${path}`).toBe(StatusMap.Forbidden);
            expect(await response.json()).toMatchObject({
              code: 'DEMO_READ_ONLY',
              message: expect.stringContaining('read-only'),
            });
          }
        }
        for (const path of [
          '/api/auth/sign-out',
          '/api/auth/passkey/generate-register-options',
          '/api/api-keys',
          '/api/mcp/clients',
          '/api/owner-registration',
          '/mcp',
          '/mcp/asset-transfers/token',
          '/.well-known/oauth-authorization-server',
          '/openapi',
          '/api/future-route',
          '/api/pages/a/archive',
          '/api/entities/a/image',
          '/api/%70ages',
          '/api/pages/a%2farchive',
          '/api//pages',
          '/api/pages/',
          '/setup',
          '/login',
          '/mcp/authorize',
        ]) {
          expect((await read(path)).status, path).toBe(StatusMap.Forbidden);
        }
        // A missed HTTP restriction still cannot mutate either persistence boundary.
        await expect(storage.write('escape', new Blob(['changed']))).rejects.toThrow('read-only');
        await expect(storage.delete('escape')).rejects.toThrow('read-only');
        await expect(crops.write('escape', new Blob(['changed']))).rejects.toThrow('read-only');
        expect(() => facesDatabase.exec('DELETE FROM asset_face')).toThrow('readonly');
        await expect(
          resources.assetsService.faces.process({
            ownerId: DEMO_OWNER_ID,
            readableId: 'steve-presenting-iphone',
          }),
        ).rejects.toThrow('read-only');
        await expect(
          (async () => await database.unsafe("UPDATE auth_user SET name = 'Changed'"))(),
        ).rejects.toThrow();
        expect(await fingerprint(dataFolder)).toEqual(before);

        const user = await database`SELECT name FROM auth_user WHERE id = ${DEMO_OWNER_ID}`;
        expect(user[0].name).toBe('Steve Jobs');
      } finally {
        facesDatabase.close();
        await database.close();
      }
    } finally {
      await rm(dataFolder, { recursive: true, force: true });
    }
  },
  TEST_TIMEOUT_MS,
);

test('personal resource controllers require real authentication even with demo metadata', async () => {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-demo-personal-test-'));
  const database = await createSqliteDatabase({ dataFolder });
  try {
    await runMigrations({ db: database });
    const pagesService = new KnowledgePagesService({
      pages: new KnowledgePagesRepository(database),
      storage: createLocalStorage({ dataFolder }),
    });
    // The exact same controller with real personal authentication still rejects anonymity,
    // even with the demo's public metadata supplied as a forged cookie/token.
    const auth = createAuth({
      database,
      baseUrl: new URL('https://personal.test'),
      secret: 'test-only-personal-auth-secret-123456789',
      fetchClientMetadataResource: () => Promise.reject(new Error('Unexpected OAuth lookup')),
    });
    const personal = new Elysia({ prefix: '/api' })
      .onError(elysiaErrorHandler)
      .use(createPagesController({ auth, pagesService }));
    for (const headers of [
      new Headers(),
      new Headers({
        cookie: 'better-auth.session_token=public-demo-not-a-credential',
        authorization: 'Bearer public-demo-not-a-credential',
      }),
    ]) {
      const response = await personal.handle(
        new Request('https://personal.test/api/pages', { headers }),
      );
      expect(response.status).toBe(StatusMap.Unauthorized);
    }
  } finally {
    await database.close();
    await rm(dataFolder, { recursive: true, force: true });
  }
});

test('demo snapshot build rejects failed image analysis', async () => {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-demo-failed-faces-'));
  try {
    await expect(seedDemoSnapshot({ dataFolder, analyzer: unavailableAnalyzer })).rejects.toThrow(
      'Demo image steve-jobs-portrait-2010',
    );
  } finally {
    await rm(dataFolder, { recursive: true, force: true });
  }
});

async function assertPreviewFormats(read: (path: string) => Promise<Response>) {
  for (const [id, mediaType] of [
    ['my-product-commitment-ledger', 'text/csv'],
    ['synthetic-iphone-rehearsal-checklist', 'text/plain'],
    ['synthetic-iphone-rehearsal-handout', 'application/pdf'],
    ['synthetic-iphone-rehearsal-animation', 'video/mp4'],
  ]) {
    const content = await read(`/api/assets/${id}/content`);
    expect(content.status).toBe(StatusMap.OK);
    expect(content.headers.get('content-type')).toBe(mediaType!);
    expect(content.headers.get('content-disposition')).toStartWith('inline;');
    expect((await content.arrayBuffer()).byteLength).toBeGreaterThan(0);
  }
}
