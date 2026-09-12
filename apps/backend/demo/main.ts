import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BunFile, SQL } from 'bun';
import { createSqliteReader } from '#db/client.ts';
import { createLocalStorage } from '#lib/storage/client.ts';
import { FrontendAssetsRepository } from '#repositories/frontend-assets/repository.ts';
import { FrontendAssetsService } from '#services/frontend-assets/service.ts';
import { createDemoApp } from './app';
import { readOnlyStorage } from './read-only-storage';
import { createDemoResources } from './resources';

// Never consult DATA_FOLDER, BASE_URL, auth secrets, or any existing instance's files.
// Every boot extracts ONLY the compiled fixture snapshot into a fresh disposable directory.
const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-public-demo-'));
let database: SQL | undefined;
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
    throw new Error('Run the compiled demo binary: bun run demo:build:local');
  }
  database = createSqliteReader({ dataFolder });
  const storage = readOnlyStorage(createLocalStorage({ dataFolder }));
  const server = Bun.serve({
    hostname: '0.0.0.0',
    port: process.env.PORT ?? '3000',
    fetch: createDemoApp({
      resources: createDemoResources({ database, storage }),
      frontendAssetsService: new FrontendAssetsService(new FrontendAssetsRepository()),
    }),
  });
  console.log(`Public read-only Steve Jobs demo listening on ${server.url.origin}`);
  async function stop() {
    await server.stop(true);
    await database!.close();
    await rm(dataFolder, { recursive: true, force: true });
    process.exit(0);
  }
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
} catch (error) {
  await database?.close();
  await rm(dataFolder, { recursive: true, force: true });
  throw error;
}
