import { assetKey, assetPlaceholder, type DeliveryAsset } from '@context-use/open-sync/assets';
import type { SyncRegistration } from '@context-use/open-sync/definition';
import type { Deliverable, DeliveredRecord } from '@context-use/open-sync/delivery';
import type { SQL } from 'bun';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { createLocalStorage } from '#backend/lib/storage/client.ts';
import type { Storage } from '#backend/lib/storage/storage.ts';
import { AssetsRepository } from '#backend/repositories/assets/repository.ts';
import { HistoryRepository } from '#backend/repositories/history/repository.ts';
import { RecordsRepository } from '#backend/repositories/records/repository.ts';
import { AssetsService } from '#backend/services/assets/service.ts';
import { RecordsService } from '#backend/services/records/service.ts';
import { localRecordDestination } from '#backend/services/syncs/destinations/local/definition.ts';
import { unusedAssetFacesService } from '../../support/app.ts';

export const assetScope = { actorId: OWNER_USER_ID, ownerId: OWNER_USER_ID };
export const assetChange = { clientName: 'fixture', message: 'Imported fixture assets' };
export const fixtureFiles = [
  {
    id: 'diagram',
    version: '1',
    name: 'Design [diagram].txt',
    mediaType: 'text/plain',
    text: 'Durable design diagram',
  },
  {
    id: 'notes',
    version: '1',
    name: 'Notes [read](https://example.test)',
    mediaType: 'text/plain',
    text: 'Durable attachment notes',
  },
];
export const assetDefinition: SyncRegistration = {
  definition: {
    id: 'fixture.assets',
    name: 'Fixture assets',
    configSchema: { type: 'object' },
    checkpointSchema: { type: 'object' },
    initialCheckpoint: {},
    kinds: { summary: { type: 'object' } },
    provider: { service: 'fixture', actions: [] },
  },
  load: () => ({
    step: async ({ assets }) => {
      for (const { text, ...metadata } of fixtureFiles) {
        await assets.capture({ ...metadata, read: async () => new Blob([text]).stream() });
      }
      const { revision: _revision, ...record } = assetRecord();
      return { records: [record], checkpoint: {}, complete: true };
    },
  }),
};
export function assetRecord(): DeliveredRecord {
  return {
    operation: 'upsert',
    kind: 'summary',
    id: 'record',
    revision: 1,
    data: { attachment: assetPlaceholder('notes') },
    preview: 'Summary with attachments',
    content: {
      format: 'markdown',
      body: `![Diagram][image]\n\n[Download][image]\n\n[image]: ${assetPlaceholder('diagram')}\n\n\`${assetPlaceholder('diagram')}\`\n\n\`\`\`text\n![literal](${assetPlaceholder('diagram')})\n\`\`\``,
    },
    assetRefs: {
      diagram: { id: 'diagram', version: '1' },
      duplicate: { id: 'diagram', version: '1' },
      notes: { id: 'notes', version: '1' },
    },
  };
}
export function assetBundle(): Deliverable {
  const assets: DeliveryAsset[] = fixtureFiles.map(({ text, ...metadata }) => ({
    ...metadata,
    size: new Blob([text]).size,
    sha256: new Bun.CryptoHasher('sha256').update(text).digest('hex'),
  }));
  return {
    id: 'delivery',
    ...assetScope,
    syncId: 'sync',
    definition: assetDefinition.definition.id,
    records: [assetRecord()],
    assets,
    openAsset: (ref) => {
      const file = fixtureFiles.find((asset) => assetKey(asset) === assetKey(ref));
      if (!file) {
        throw new Error('Missing fixture asset');
      }
      return Promise.resolve(new Blob([file.text]).stream());
    },
  };
}
export function assetDelivery(deliverable: Deliverable = assetBundle()) {
  return { scope: assetScope, config: {}, deliverable, signal: new AbortController().signal };
}
export function assetHost(input: { database: SQL; dataFolder: string; storage?: Storage }) {
  const storage = input.storage ?? createLocalStorage(input);
  const assets = new AssetsService({
    assets: new AssetsRepository(input.database),
    storage,
    faces: unusedAssetFacesService,
  });
  const records = new RecordsService({ records: new RecordsRepository(input.database), storage });
  const destination = localRecordDestination({
    ownerId: OWNER_USER_ID,
    definitions: [assetDefinition],
    importAsset: (value) => assets.import(value),
    upsertRecord: (value) => records.upsert(value),
  });
  return {
    assets,
    records,
    destination,
    storage,
    list: () => records.listResources({ ownerId: OWNER_USER_ID, limit: 100, offset: 0 }),
    history: () =>
      new HistoryRepository(input.database).list({ ownerId: OWNER_USER_ID, limit: 100 }),
    listAssets: () => assets.list({ ownerId: OWNER_USER_ID, limit: 100, offset: 0 }),
  };
}
export async function insertAssetOwners(database: SQL) {
  for (const id of [OWNER_USER_ID, 'other-owner']) {
    await database`insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values (${id}, ${id}, ${`${id}@example.invalid`}, 1, '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z')`;
  }
}
