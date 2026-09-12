import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Elysia, type Static, StatusMap } from 'elysia';
import { createSqliteDatabase, createSqliteReader } from '#db/client.ts';
import { runMigrations } from '#db/migrate.ts';
import { createAuth } from '#lib/auth/better-auth.ts';
import { elysiaErrorHandler } from '#lib/errors.ts';
import { createLocalStorage } from '#lib/storage/client.ts';
import { createPagesController } from '#routes/api/pages/controller.ts';
import type { KnowledgePageListSchema, KnowledgePageSchema } from '#routes/api/pages/model.ts';
import type { RecordListSchema } from '#routes/api/records/model.ts';
import { createDemoApp } from './app';
import { DEMO_OWNER_ID } from './identity';
import { readOnlyStorage } from './read-only-storage';
import { createDemoResources } from './resources';
import { seedDemoSnapshot } from './seed';

const EXPECTED_PAGES = 49;
const EXPECTED_ENTITIES = 30;
const EXPECTED_PEOPLE = 11;
const EXPECTED_ORGANIZATIONS = 7;
const EXPECTED_UNTYPED_ENTITIES = 12;
const EXPECTED_RECORDS = 39;
const EXPECTED_ASSETS = 27;
const TEST_TIMEOUT_MS = 30_000;

async function fingerprint(folder: string) {
  const hashes: Record<string, string> = {};
  for (const path of new Bun.Glob('**/*').scanSync({ cwd: folder, onlyFiles: true })) {
    hashes[path] = new Bun.CryptoHasher('sha256')
      .update(await Bun.file(join(folder, path)).arrayBuffer())
      .digest('hex');
  }
  return hashes;
}

test(
  'anonymous demo browsing and rejected requests leave the entire snapshot unchanged',
  async () => {
    const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-demo-test-'));
    try {
      await seedDemoSnapshot({ dataFolder });
      const database = createSqliteReader({ dataFolder });
      try {
        const storage = readOnlyStorage(createLocalStorage({ dataFolder }));
        const resources = createDemoResources({ database, storage });
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
          ['/api/pages?limit=50', EXPECTED_PAGES],
          ['/api/entities?limit=50', EXPECTED_ENTITIES],
          ['/api/entities?limit=50&entityType=person', EXPECTED_PEOPLE],
          ['/api/entities?limit=50&entityType=organization', EXPECTED_ORGANIZATIONS],
          ['/api/entities?limit=50&entityType=untyped', EXPECTED_UNTYPED_ENTITIES],
          ['/api/records?limit=50', EXPECTED_RECORDS],
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
          '/api/pages/my-work-from-ipod-to-iphone/preview',
          '/api/assets/steve-presenting-iphone',
          '/api/assets/steve-presenting-iphone/content',
          '/api/assets/steve-presenting-iphone/faces',
          '/api/face-recognition/settings',
          '/api/records/filter-options',
          '/api/hypermedia/entities?anchor=steve-jobs',
          '/api/hypermedia/pages',
          '/api/hypermedia/search?query=iPhone',
          '/hypermedia',
          '/pages/new',
          '/entities/new',
          '/assets/new',
          '/settings',
          '/settings/syncs',
          '/settings/faces',
          '/test.js',
        ]) {
          const response = await read(path);
          expect(response.status, path).toBe(StatusMap.OK);
          expect(response.headers.has('set-cookie')).toBe(false);
          await response.arrayBuffer();
        }
        const page = (await (
          await read('/api/pages/bringing-our-music-work-into-phones')
        ).json()) as Static<typeof KnowledgePageSchema>;
        expect(
          await (await read('/api/assets/steve-presenting-iphone/faces')).json(),
        ).toMatchObject({
          state: 'not_processed',
          faces: [],
        });
        expect(await (await read('/api/entities/steve-jobs/images')).json()).toEqual({
          items: [],
          nextOffset: null,
        });
        expect(page.revisions.length).toBeGreaterThan(1);
        const records = (await (await read('/api/records?limit=50')).json()) as Static<
          typeof RecordListSchema
        >;
        for (const record of records.items) {
          expect((await read(`/api/records/${record.readableId}`)).status).toBe(StatusMap.OK);
        }
        const head = await fetchDemo(
          new Request('http://demo.test/api/profile', { method: 'HEAD' }),
        );
        expect(head.status).toBe(StatusMap.OK);
        expect(await head.text()).toBe('');
        // Try every mutation registered by the reused controllers, plus unmounted surfaces.
        const deniedPaths = [
          '/api/pages',
          '/api/pages/my-work-from-ipod-to-iphone',
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
          '/api/profile',
          '/api/records/batch',
          '/api/syncs',
          '/api/syncs/research/revoke',
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
          '/api/syncs',
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
    const resources = createDemoResources({
      database,
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
      .use(createPagesController({ auth, pagesService: resources.pagesService }));
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

test(
  'the production backend import graph cannot reach the demo entry, identity, or fixtures',
  async () => {
    // A fresh bundler process exercises the same resolver as the production build,
    // independently of Bun test's module loader.
    const build = Bun.spawn(
      [
        process.execPath,
        '-e',
        `
      const result = await Bun.build({entrypoints: ['src/main.ts'], target: 'bun', metafile: true});
      if (!result.success) throw new AggregateError(result.logs);
      console.log(JSON.stringify(Object.keys(result.metafile.inputs)));
    `,
      ],
      { cwd: resolve(import.meta.dir, '..'), stdout: 'pipe', stderr: 'pipe' },
    );
    const inputs: string[] = JSON.parse(await new Response(build.stdout).text());
    expect(await build.exited).toBe(0);
    expect(inputs.some((path) => path.endsWith('/lib/auth/better-auth.ts'))).toBe(true);
    expect(inputs.filter((path) => path.includes('/demo/') || path.includes('/seeds/'))).toEqual(
      [],
    );
  },
  TEST_TIMEOUT_MS,
);
