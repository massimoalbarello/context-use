import { expect, test } from 'bun:test';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import type { MediaPreviewProcessor } from '#backend/lib/media-preview/processor.ts';
import { createLocalStorage } from '#backend/lib/storage/client.ts';
import { AssetPreviewsRepository } from '#backend/repositories/asset-previews/repository.ts';
import { AssetsRepository } from '#backend/repositories/assets/repository.ts';
import { AssetPreviewsService } from '#backend/services/assets/previews.ts';
import { AssetsService } from '#backend/services/assets/service.ts';
import { withRecordTestDatabase } from '../../repositories/records/database.ts';
import { unusedAssetFacesService } from '../../support/app.ts';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Z5sAAAAASUVORK5CYII=',
  'base64',
);
const dimensions = { width: 1, height: 1 };

async function withPreviews({
  run,
  generate,
}: {
  run: (fixture: {
    assets: AssetsService;
    repository: AssetPreviewsRepository;
    service: AssetPreviewsService;
    storage: ReturnType<typeof createLocalStorage>;
    source: { ownerId: string; readableId: string };
  }) => Promise<void>;
  generate: MediaPreviewProcessor['generate'];
}) {
  await withRecordTestDatabase({
    run: async (input) => {
      await input.database`insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values (${OWNER_USER_ID}, 'Owner', 'owner@example.invalid', 1, '2026-09-24', '2026-09-24')`;
      const storage = createLocalStorage(input);
      const assets = new AssetsService({
        assets: new AssetsRepository(input.database),
        storage,
        faces: unusedAssetFacesService,
      });
      const source = { ownerId: OWNER_USER_ID, readableId: 'image' };
      await assets.create({
        ...source,
        name: 'Image',
        file: new Blob([PNG]),
        change: { clientName: null, message: 'Upload image' },
      });
      const repository = new AssetPreviewsRepository(input.database);
      const service = new AssetPreviewsService({
        repository,
        storage,
        processor: { prepare: async () => {}, generate },
      });
      try {
        await run({ assets, repository, service, storage, source });
      } finally {
        await service.close();
      }
    },
  });
}

test('previews are persisted once, scoped to the owner, and leave original downloads intact', async () => {
  const previewBytes = 'small';
  await withPreviews({
    run: async ({ service, repository, assets, storage, source }) => {
      expect(await service.runNext()).toBe(true);
      expect(await repository.next()).toBeNull();
      expect(await service.runNext()).toBe(false);
      const detail = await assets.detail(source);
      expect(detail?.preview).toMatchObject(dimensions);
      expect(
        (await assets.list({ ownerId: source.ownerId, limit: 10, offset: 0 })).items[0]?.preview,
      ).toEqual(detail?.preview);
      const preview = await assets.content({ ...source, preview: true });
      expect(preview?.asset.mediaType).toBe('image/webp');
      expect(await preview?.blob.text()).toBe(previewBytes);
      expect(await (await assets.content(source))?.blob.bytes()).toEqual(PNG);
      expect(
        await assets.content({ ...source, ownerId: 'another-owner', preview: true }),
      ).toBeNull();
      await storage.delete(preview!.asset.storageKey);
      expect(await (await assets.content({ ...source, preview: true }))?.blob.bytes()).toEqual(PNG);
    },
    generate: async () => ({
      ...dimensions,
      blob: new Blob([previewBytes], { type: 'image/webp' }),
    }),
  });
});

test('failed or larger previews are not retried on every page read or worker restart', async () => {
  for (const generate of [
    () => Promise.reject(new Error('Unsupported or malformed media')),
    async () => ({ ...dimensions, blob: new Blob([PNG, PNG]) }),
  ]) {
    await withPreviews({
      run: async ({ service, repository, assets, source }) => {
        expect(await service.runNext()).toBe(true);
        expect(await repository.next()).toBeNull();
        expect((await assets.detail(source))?.preview).toBeUndefined();
        expect(await (await assets.content({ ...source, preview: true }))?.blob.bytes()).toEqual(
          PNG,
        );
      },
      generate,
    });
  }
});

test('shutdown leaves interrupted preview work pending for the next worker', async () => {
  const entered = Promise.withResolvers<void>();
  await withPreviews({
    run: async ({ service, repository }) => {
      service.start();
      await entered.promise;
      await service.close();
      expect(await repository.next()).not.toBeNull();
    },
    generate: async ({ signal }) => {
      entered.resolve();
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      signal.throwIfAborted();
      throw new Error('Expected cancellation');
    },
  });
});
