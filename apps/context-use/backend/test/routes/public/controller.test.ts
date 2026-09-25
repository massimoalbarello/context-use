import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia, StatusMap } from 'elysia';
import { createSqliteDatabase } from '#backend/db/client.ts';
import { runMigrations } from '#backend/db/migrate.ts';
import { elysiaErrorHandler } from '#backend/lib/errors.ts';
import { LocalStorage } from '#backend/lib/storage/local-storage.ts';
import { AssetsRepository } from '#backend/repositories/assets/repository.ts';
import { PublicResourcesRepository } from '#backend/repositories/public-resources/repository.ts';
import { PublicationsRepository } from '#backend/repositories/publications/repository.ts';
import { createPublicController } from '#backend/routes/public/controller.ts';
import { AssetsService } from '#backend/services/assets/service.ts';
import { PublicResourcesService } from '#backend/services/public-resources/service.ts';
import { unusedAssetFacesService } from '../../support/app.ts';

const NOW = '2026-09-24T09:00:00.000Z';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Z5sAAAAASUVORK5CYII=',
  'base64',
);

async function withPublicAssets(
  run: (fixture: Awaited<ReturnType<typeof publicAssetsFixture>>) => Promise<void>,
) {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-public-assets-'));
  const database = await createSqliteDatabase({ dataFolder });
  try {
    await runMigrations({ db: database });
    await run(await publicAssetsFixture({ database, dataFolder }));
  } finally {
    await database.close();
    await rm(dataFolder, { recursive: true, force: true });
  }
}

async function publicAssetsFixture({
  database,
  dataFolder,
}: {
  database: Awaited<ReturnType<typeof createSqliteDatabase>>;
  dataFolder: string;
}) {
  for (const ownerId of ['owner-a', 'owner-b']) {
    await database`
      insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
      values (${ownerId}, 'Owner', ${`${ownerId}@example.invalid`}, 1, ${NOW}, ${NOW})
    `;
  }
  const storage = new LocalStorage(join(dataFolder, 'objects'));
  const assetsRepository = new AssetsRepository(database);
  const assets = new AssetsService({
    assets: assetsRepository,
    storage,
    faces: unusedAssetFacesService,
  });
  const resources = new PublicResourcesRepository(database);
  const service = new PublicResourcesService({ resources, storage });
  const publications = new PublicationsRepository(database);
  const app = new Elysia().onError(elysiaErrorHandler).use(
    createPublicController({
      publicResourcesService: service,
      ownerId: 'owner-a',
    }),
  );
  async function create({
    name,
    bytes = PNG,
    ownerId = 'owner-a',
  }: {
    name: string;
    bytes?: Uint8Array<ArrayBuffer>;
    ownerId?: string;
  }) {
    const result = await assets.create({
      ownerId,
      name,
      file: new Blob([bytes]),
      change: { clientName: null, message: 'Added test asset' },
    });
    if (result.state !== 'created') {
      throw new Error('Expected test asset');
    }
    return result.asset;
  }
  async function transition({
    readableId,
    action,
    ownerId = 'owner-a',
  }: {
    readableId: string;
    action: 'publish' | 'unpublish';
    ownerId?: string;
  }) {
    const input = { ownerId, readableId, resourceType: 'asset' as const, action };
    const preparation = await publications.prepare(input);
    if (!preparation) {
      throw new Error('Expected publication preparation');
    }
    const result = await publications.execute({
      ...input,
      expectedState: preparation.expectedState,
      publishedAt: NOW,
    });
    if (result.state !== 'changed' || !result.publication.publicId) {
      throw new Error('Expected publication transition');
    }
    return result.publication.publicId;
  }
  const request = ({ id, cookie }: { id: string; cookie?: string }) =>
    app.handle(
      new Request(`http://localhost/public/assets/${encodeURIComponent(id)}`, {
        headers: cookie ? { cookie } : {},
      }),
    );
  return { database, storage, assetsRepository, resources, service, create, transition, request };
}

test('public reads return only verified bytes and restricted projections, identically with cookies', async () => {
  await withPublicAssets(async ({ create, transition, request, resources, service }) => {
    const asset = await create({ name: 'Approved image' });
    const publicId = await transition({ readableId: asset.readableId, action: 'publish' });
    expect(publicId).not.toBe(asset.id);
    expect(publicId).not.toBe(asset.readableId);
    for (const id of [asset.id, asset.readableId]) {
      const response = await request({ id });
      expect(response.status).toBe(StatusMap['Not Found']);
      expect(await response.json()).toEqual({ error: 'Not Found' });
    }
    expect(Object.keys((await resources.findAsset({ publicId }))!).sort()).toEqual([
      'contentHash',
      'extension',
      'mediaType',
      'name',
      'sizeBytes',
      'storageKey',
    ]);
    const content = await service.assetContent({ publicId });
    expect(Object.keys(content!).sort()).toEqual(['asset', 'blob']);
    expect(content?.asset).toEqual({
      name: 'Approved image',
      mediaType: 'image/png',
      extension: 'png',
      sizeBytes: PNG.byteLength,
    });
    const anonymous = await request({ id: publicId });
    const withCookie = await request({
      id: publicId,
      cookie: 'better-auth.session_token=owner-session',
    });
    expect(anonymous.status).toBe(StatusMap.OK);
    expect(withCookie.status).toBe(anonymous.status);
    expect([...withCookie.headers]).toEqual([...anonymous.headers]);
    expect(new Uint8Array(await anonymous.arrayBuffer())).toEqual(PNG);
    expect(new Uint8Array(await withCookie.arrayBuffer())).toEqual(PNG);
    expect(anonymous.headers.get('content-type')).toBe('image/png');
    expect(anonymous.headers.get('content-disposition')).toStartWith('inline;');
    expect(anonymous.headers.get('cache-control')).toBe('private, no-store');
    expect(anonymous.headers.get('x-content-type-options')).toBe('nosniff');
    expect(anonymous.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    const headers = JSON.stringify([...anonymous.headers]);
    for (const privateValue of [
      asset.id,
      asset.readableId,
      'owner-a',
      'storageKey',
      'usages',
      'depicts',
      'records',
    ]) {
      expect(headers).not.toContain(privateValue);
    }
  });
});

test('private, foreign private, unknown, withdrawn and archived identifiers have the same 404', async () => {
  await withPublicAssets(async ({ create, transition, request, database }) => {
    const published = await create({ name: 'Published' });
    const privateAsset = await create({ name: 'Private' });
    const foreign = await create({ name: 'Foreign', ownerId: 'owner-b' });
    const publicId = await transition({ readableId: published.readableId, action: 'publish' });
    expect(await transition({ readableId: published.readableId, action: 'unpublish' })).toBe(
      publicId,
    );
    for (const id of [
      publicId,
      published.readableId,
      published.id,
      privateAsset.readableId,
      privateAsset.id,
      foreign.readableId,
      foreign.id,
      'asset_unknown',
      'asset_00000000-0000-4000-8000-000000000000',
      'invalid!',
    ]) {
      for (const cookie of [undefined, 'better-auth.session_token=owner-session']) {
        const response = await request({ id, cookie });
        expect(response.status).toBe(StatusMap['Not Found']);
        expect(await response.json()).toEqual({ error: 'Not Found' });
        expect(response.headers.get('cache-control')).toBe('private, no-store');
      }
    }
    expect(await transition({ readableId: published.readableId, action: 'publish' })).toBe(
      publicId,
    );
    expect((await request({ id: publicId })).status).toBe(StatusMap.OK);
    // Guard against archived rows even if state was changed outside the normal archive API.
    await database`update "asset" set "archived_at" = ${NOW} where "id" = ${published.id}`;
    const archived = await request({ id: publicId });
    expect(archived.status).toBe(StatusMap['Not Found']);
    expect(await archived.json()).toEqual({ error: 'Not Found' });
  });
});

test('public IDs distinguish owners with the same private readable ID', async () => {
  await withPublicAssets(async ({ create, transition, request }) => {
    const first = await create({
      name: 'Shared name',
      bytes: new TextEncoder().encode('First owner'),
    });
    const second = await create({
      name: 'Shared name',
      bytes: new TextEncoder().encode('Second owner'),
      ownerId: 'owner-b',
    });
    expect(first.readableId).toBe(second.readableId);
    const firstId = await transition({ readableId: first.readableId, action: 'publish' });
    const secondId = await transition({
      readableId: second.readableId,
      ownerId: 'owner-b',
      action: 'publish',
    });
    expect(firstId).not.toBe(secondId);
    expect(await (await request({ id: firstId })).text()).toBe('First owner');
    expect(await (await request({ id: secondId })).text()).toBe('Second owner');
    await transition({ readableId: first.readableId, action: 'unpublish' });
    expect((await request({ id: firstId })).status).toBe(StatusMap['Not Found']);
    expect(await (await request({ id: secondId })).text()).toBe('Second owner');
  });
});

test('HTML, SVG and PDF content is downloaded with safe filenames, nosniff and a restrictive sandbox', async () => {
  await withPublicAssets(async ({ create, transition, request }) => {
    for (const [name, source, mediaType] of [
      [
        'Markup "\r\nX-Test: injected',
        '<html><script>alert(document.cookie)</script></html>',
        'text/plain',
      ],
      [
        'Vector',
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.cookie)"/>',
        'text/plain',
      ],
      ['Document', '%PDF-1.7\nasset preview', 'application/pdf'],
    ]) {
      const bytes = Buffer.from(source!);
      const asset = await create({ name: name!, bytes });
      const response = await request({
        id: await transition({ readableId: asset.readableId, action: 'publish' }),
      });
      expect(response.status).toBe(StatusMap.OK);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
      expect(response.headers.get('content-type')).toBe(mediaType!);
      expect(response.headers.get('content-disposition')).toStartWith('attachment; filename="');
      expect(response.headers.get('content-disposition')).not.toMatch(/[\r\n]/);
      expect(response.headers.has('x-test')).toBe(false);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    }
  });
});

test('missing, same-size replaced and truncated stored bytes never reach a public response', async () => {
  await withPublicAssets(async ({ create, transition, request, assetsRepository, storage }) => {
    const asset = await create({ name: 'Integrity protected' });
    const publicId = await transition({ readableId: asset.readableId, action: 'publish' });
    const stored = (await assetsRepository.find({
      ownerId: 'owner-a',
      readableId: asset.readableId,
    }))!;
    await storage.delete(stored.storageKey);
    for (const replacement of [null, Buffer.alloc(PNG.byteLength), PNG.subarray(1)]) {
      if (replacement) {
        await storage.write(stored.storageKey, new Blob([replacement]));
      }
      const response = await request({ id: publicId });
      expect(response.status).toBe(StatusMap['Internal Server Error']);
      expect(await response.json()).toEqual({ error: 'Internal server error' });
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    await storage.write(stored.storageKey, new Blob([PNG]));
    expect(new Uint8Array(await (await request({ id: publicId })).arrayBuffer())).toEqual(PNG);
  });
});
