import type { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteReader, createSynchronousSqliteReader } from '@repo/backend/db/client';
import { LOCAL_FACE_MODEL } from '@repo/backend/lib/face-analysis/models';
import { createLocalStorage } from '@repo/backend/lib/storage/client';
import { LocalStorage } from '@repo/backend/lib/storage/local-storage';
import { FrontendAssetsRepository } from '@repo/backend/repositories/frontend-assets/repository';
import { FrontendAssetsService } from '@repo/backend/services/frontend-assets/service';
import type { BunFile, SQL } from 'bun';
import { createDemoApp } from './app';
import { readOnlyStorage } from './read-only-storage';
import { createDemoResources } from './resources';

// Never consult DATA_FOLDER, BASE_URL, auth secrets, or any existing instance's files.
// Every boot extracts ONLY the compiled fixture snapshot into a fresh disposable directory.
const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-public-demo-'));
let database: SQL | undefined;
let facesDatabase: Database | undefined;
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
  const server = Bun.serve({
    hostname: '0.0.0.0',
    port: process.env.PORT ?? '3000',
    fetch: createDemoApp({
      resources: createDemoResources({
        database,
        facesDatabase,
        storage,
        crops: readOnlyStorage(new LocalStorage(join(dataFolder, 'face-crops'))),
        analyzer: {
          model: LOCAL_FACE_MODEL,
          analyze: () => Promise.reject(new Error('Public demo cannot run face analysis')),
        },
      }),
      frontendAssetsService: new FrontendAssetsService(new FrontendAssetsRepository()),
    }),
  });
  console.log(`Public read-only Steve Jobs demo listening on ${server.url.origin}`);
  async function stop() {
    await server.stop(true);
    await database!.close();
    facesDatabase!.close();
    await rm(dataFolder, { recursive: true, force: true });
    process.exit(0);
  }
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
} catch (error) {
  await database?.close();
  facesDatabase?.close();
  await rm(dataFolder, { recursive: true, force: true });
  throw error;
}
