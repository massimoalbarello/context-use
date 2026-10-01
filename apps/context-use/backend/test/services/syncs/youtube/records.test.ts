import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createSyncRuntime } from '@context-use/open-sync/engine';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { createLocalStorage } from '#backend/lib/storage/client.ts';
import { HistoryRepository } from '#backend/repositories/history/repository.ts';
import { RecordsRepository } from '#backend/repositories/records/repository.ts';
import { RecordsService } from '#backend/services/records/service.ts';
import { localRecordDestination } from '#backend/services/syncs/destinations/local/definition.ts';
import { youtubePlaylists } from '#backend/services/syncs/sources/youtube/definition.ts';
import { withRecordTestDatabase } from '../../../repositories/records/database.ts';
import {
  addedAt,
  archiveCount,
  archiveRecordCount,
  item,
  youtubeFixture,
} from './youtube-fixture.ts';

const scope = { actorId: OWNER_USER_ID, ownerId: OWNER_USER_ID };
function unexpected(): never {
  throw new Error('Unexpected asset import');
}

test('YouTube stores only video memberships with playlist details and source creation time across restart and append polls', async () => {
  await withRecordTestDatabase({
    run: async (input) => {
      await input.database`insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values (${OWNER_USER_ID}, 'Owner', 'owner@example.invalid', 1, ${addedAt}, ${addedAt})`;
      const records = new RecordsService({
        records: new RecordsRepository(input.database),
        storage: createLocalStorage(input),
      });
      const source = youtubeFixture();
      const options = {
        databasePath: join(input.dataFolder, 'sync.db'),
        definitions: [youtubePlaylists],
        connector: { bind: () => Promise.resolve(source.provider) },
        destinationTypes: {
          local: localRecordDestination({
            ownerId: OWNER_USER_ID,
            definitions: [youtubePlaylists],
            importAsset: unexpected,
            upsertRecord: (value) => records.upsert(value),
          }),
        },
      };
      let runtime = createSyncRuntime(options);
      try {
        const sync = await runtime.api.createSync({
          ...scope,
          definition: youtubePlaylists.definition.id,
          connection: { id: 'youtube-owner', service: 'youtube' },
          destination: { type: 'local', input: {} },
          config: {},
        });
        const resource = { ...scope, id: sync.id };
        const finish = async () => {
          const maxTicks = 30;
          for (let tick = 0; tick < maxTicks; tick++) {
            await runtime.tick();
            if (
              runtime.api.sync(resource).status === 'succeeded' &&
              runtime.api.status(scope).queue.pendingRecords === 0
            ) {
              return;
            }
          }
          throw new Error('YouTube delivery did not finish');
        };
        await runtime.tick();
        await runtime.close();
        runtime = createSyncRuntime(options);
        await finish();
        const list = () => records.listResources({ ownerId: OWNER_USER_ID, limit: 200, offset: 0 });
        const stored = await list();
        expect(stored.items).toHaveLength(archiveRecordCount);
        expect(stored.items.every((record) => record.source.kind === 'playlist-item')).toBe(true);
        const first = stored.items.find((record) => record.source.id === 'a-membership-0')!;
        expect(
          await records.findResource({ ownerId: OWNER_USER_ID, readableId: first.readableId }),
        ).toMatchObject({
          title: 'Video 0',
          source: { provider: 'youtube', kind: 'playlist-item', id: 'a-membership-0' },
          sourceCreatedAt: new Date(addedAt).toISOString(),
          sourceUpdatedAt: null,
          body: '# Video 0\n\nVideo: https://www.youtube.com/watch?v=video-0\n\nChannel: Uploader\n\nSaved at: 2020-01-02T03:04:05Z\n\nPlaylist: Playlist a\n\nPlaylist URL: https://www.youtube.com/playlist?list=a',
        });
        const second = stored.items.find((record) => record.source.id === 'b-membership-0')!;
        const resumed = stored.items.find(
          (record) => record.source.id === `a-membership-${archiveCount - 1}`,
        )!;
        expect(
          await records.findResource({ ownerId: OWNER_USER_ID, readableId: resumed.readableId }),
        ).toMatchObject({
          body: expect.stringContaining('Playlist: Playlist a'),
        });
        expect(second.readableId).not.toBe(first.readableId);
        expect(
          await records.findResource({ ownerId: OWNER_USER_ID, readableId: second.readableId }),
        ).toMatchObject({
          title: 'Video 0',
          body: expect.stringContaining('Playlist: Playlist b'),
        });
        const history = () =>
          new HistoryRepository(input.database).list({
            ownerId: OWNER_USER_ID,
            limit: 200,
            resourceType: 'record',
          });
        const originalHistory = await history();
        runtime.api.runNow(resource);
        await finish();
        expect(await history()).toEqual(originalHistory);
        source.listings.get('a')!.push(item({ playlistId: 'a', index: archiveCount }));
        source.requests.length = 0;
        runtime.api.runNow(resource);
        await finish();
        expect((await list()).items).toHaveLength(archiveRecordCount + 1);
        expect(source.itemRequests).toEqual([
          ['a', 'opaque-hundred'],
          ['b', null],
        ]);
        const added = (await list()).items.find(
          (record) => record.source.id === `a-membership-${archiveCount}`,
        )!;
        expect(added.sourceCreatedAt).toBe(new Date(addedAt).toISOString());
        await runtime.api.setEnabled({ ...resource, enabled: false });
        const beforeBackfill = await list();
        source.requests.length = 0;
        await runtime.api.setEnabled({ ...resource, enabled: true });
        await runtime.api.resync(resource);
        runtime.api.runNow(resource);
        await finish();
        expect(await list()).toEqual(beforeBackfill);
        expect(source.itemRequests).toContainEqual(['a', null]);
      } finally {
        await runtime.close();
      }
    },
  });
});
