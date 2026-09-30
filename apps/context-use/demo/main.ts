import type { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenSync, type OpenSyncRuntime } from '@context-use/open-sync';
import type { BunFile, SQL } from 'bun';
import { createSqliteReader, createSynchronousSqliteReader } from '#backend/db/client.ts';
import { loadEnv } from '#backend/lib/env.ts';
import { LOCAL_FACE_MODEL } from '#backend/lib/face-analysis/models.ts';
import { createLocalStorage } from '#backend/lib/storage/client.ts';
import { LocalStorage } from '#backend/lib/storage/local-storage.ts';
import { FrontendAssetsRepository } from '#backend/repositories/frontend-assets/repository.ts';
import { FrontendAssetsService } from '#backend/services/frontend-assets/service.ts';
import { SyncCatalog } from '#backend/services/syncs/catalog.ts';
import { ManagedSyncsService } from '#backend/services/syncs/managed.ts';
import { syncProviders } from '#backend/services/syncs/sources/index.ts';
import { createDemoApp } from './app';
import { readOnlyStorage } from './read-only-storage';
import { createDemoResources } from './resources';

// Never consult DATA_FOLDER, auth secrets, or any existing instance's files.
// Every boot extracts ONLY the compiled fixture snapshot into a fresh disposable directory.
const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-public-demo-'));
let database: SQL | undefined;
let facesDatabase: Database | undefined;
let sync: OpenSyncRuntime | undefined;
try {
  const snapshotPrefix = 'demo-seed/';
  let extracted = false;
  for (const file of Bun.embeddedFiles as readonly BunFile[]) {
    if (file.name?.startsWith(snapshotPrefix)) {
      await Bun.write(join(dataFolder, file.name.slice(snapshotPrefix.length)), file);
      extracted = true;
    }
  }
  if (!extracted) {
    throw new Error('Run the compiled demo binary: BUILD_TARGET=host bun run build:demo');
  }
  database = createSqliteReader({ dataFolder });
  facesDatabase = createSynchronousSqliteReader({ dataFolder });
  const storage = readOnlyStorage(createLocalStorage({ dataFolder }));
  const { BASE_URL } = loadEnv({
    environment: {
      BASE_URL: process.env.BASE_URL,
      NIBRUN_HOSTNAME: process.env.NIBRUN_HOSTNAME,
    },
  });
  const catalog = new SyncCatalog(syncProviders);
  sync = await createOpenSync({
    dataDirectory: join(dataFolder, 'open-sync'),
    publicUrl: new URL('/api/open-sync', BASE_URL).href,
    definitions: catalog.definitions,
    destinationTypes: {},
    authorize: () => null,
    canConfigureProviders: () => Promise.resolve(false),
  });
  const server = Bun.serve({
    hostname: '0.0.0.0',
    port: process.env.PORT ?? '3000',
    fetch: createDemoApp({
      managedSyncsService: new ManagedSyncsService({ sync, catalog }),
      resources: createDemoResources({
        database,
        facesDatabase,
        storage,
        crops: readOnlyStorage(new LocalStorage(join(dataFolder, 'face-crops'))),
        analyzer: {
          model: LOCAL_FACE_MODEL,
          status: async () => ({
            state: 'unavailable',
            downloaded: false,
            error: 'This read-only demo uses preprocessed images.',
            checkedAt: null,
          }),
          check: () => Promise.reject(new Error('Public demo cannot run face analysis')),
          analyze: () => Promise.reject(new Error('Public demo cannot run face analysis')),
        },
      }),
      frontendAssetsService: new FrontendAssetsService(new FrontendAssetsRepository()),
    }),
  });
  console.log(`Public read-only Steve Jobs demo listening on ${server.url.origin}`);
  async function stop() {
    await server.stop(true);
    await sync!.close();
    await database!.close();
    facesDatabase!.close();
    await rm(dataFolder, { recursive: true, force: true });
    process.exit(0);
  }
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
} catch (error) {
  await sync?.close();
  await database?.close();
  facesDatabase?.close();
  await rm(dataFolder, { recursive: true, force: true });
  throw error;
}
