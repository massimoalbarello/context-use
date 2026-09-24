import { expect, mock, test } from 'bun:test';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { createLocalStorage } from '#backend/lib/storage/client.ts';
import { MAX_ASSET_BYTES, MAX_ASSET_NAME_LENGTH } from '#backend/models/assets/model.ts';
import { AssetsRepository } from '#backend/repositories/assets/repository.ts';
import { AssetsService } from '#backend/services/assets/service.ts';
import { withRecordTestDatabase } from '../../repositories/records/database.ts';
import { unusedAssetFacesService } from '../../support/app.ts';

test('uploads and imports enforce the same asset rules before reading bytes or saving', async () => {
  await withRecordTestDatabase({
    run: async (input) => {
      const wake = mock(() => {});
      const assets = new AssetsService({
        assets: new AssetsRepository(input.database),
        storage: createLocalStorage(input),
        faces: { ...unusedAssetFacesService, notifyAssetSaved: wake },
      });
      const scope = { ownerId: OWNER_USER_ID, change: { clientName: null, message: 'Upload' } };
      const file = new Blob(['asset']);
      const imported = {
        ...scope,
        signal: new AbortController().signal,
        read: (): Promise<ReadableStream<Uint8Array>> => {
          throw new Error('Invalid assets must not open a stream');
        },
      };
      const identity = { ownerId: scope.ownerId, readableId: 'imported', contentHash: '' };
      for (const value of [
        { name: '   ', file },
        { name: 'x'.repeat(MAX_ASSET_NAME_LENGTH + 1), file },
        { name: 'Empty', file: new Blob([]) },
      ]) {
        const created = await assets.create({ ...scope, ...value });
        if (created.state !== 'invalid') {
          throw new Error('Invalid upload was not rejected');
        }
        expect(
          await assets.import({
            ...imported,
            asset: { ...identity, name: value.name, sizeBytes: value.file.size },
          }),
        ).toEqual(created);
      }
      for (const sizeBytes of [MAX_ASSET_BYTES + 1, -1, Number.NaN]) {
        expect(
          (await assets.import({ ...imported, asset: { ...identity, name: 'Asset', sizeBytes } }))
            .state,
        ).toBe('invalid');
      }
      expect((await assets.list({ ...scope, limit: 10, offset: 0 })).items).toEqual([]);
      expect(wake).not.toHaveBeenCalled();
    },
  });
});

test('both entry points notify after saving, and notification failures cannot delete committed files', async () => {
  await withRecordTestDatabase({
    run: async (input) => {
      await input.database`insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values (${OWNER_USER_ID}, 'Owner', 'owner@example.invalid', 1, '2026-09-24', '2026-09-24')`;
      const wake = mock(() => {});
      const assets = new AssetsService({
        assets: new AssetsRepository(input.database),
        storage: createLocalStorage(input),
        faces: { ...unusedAssetFacesService, notifyAssetSaved: wake },
      });
      const scope = { ownerId: OWNER_USER_ID, change: { clientName: null, message: 'Upload' } };
      const file = new Blob(['asset']);
      const upload = () => assets.create({ ...scope, name: '  Uploaded  ', file });
      const imported = {
        ...scope,
        asset: {
          ownerId: scope.ownerId,
          readableId: 'imported',
          name: '  Imported  ',
          sizeBytes: file.size,
          contentHash: new Bun.CryptoHasher('sha256').update('asset').digest('hex'),
        },
        read: async () => file.stream(),
        signal: new AbortController().signal,
      };
      expect((await upload()).state).toBe('created');
      expect(await assets.import(imported)).toEqual({ state: 'ready', readableId: 'imported' });
      expect(wake).toHaveBeenCalledTimes(2);
      expect((await upload()).state).toBe('name_conflict');
      expect((await assets.import(imported)).state).toBe('ready');
      expect(wake).toHaveBeenCalledTimes(2);
      for (const readableId of ['uploaded', 'imported']) {
        const stored = await assets.content({ ...scope, readableId });
        expect(await stored?.blob.text()).toBe('asset');
        expect(stored?.asset.name).toBe(readableId === 'uploaded' ? 'Uploaded' : 'Imported');
      }
      wake.mockImplementation(() => {
        throw new Error('Wake failed');
      });
      await expect(assets.create({ ...scope, name: 'Committed upload', file })).rejects.toThrow(
        'Wake failed',
      );
      await expect(
        assets.import({
          ...imported,
          asset: { ...imported.asset, readableId: 'committed-import' },
        }),
      ).rejects.toThrow('Wake failed');
      for (const readableId of ['committed-upload', 'committed-import']) {
        expect(await (await assets.content({ ...scope, readableId }))?.blob.text()).toBe('asset');
      }
    },
  });
});
