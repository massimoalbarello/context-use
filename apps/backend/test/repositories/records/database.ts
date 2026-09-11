import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SQL } from 'bun';
import { createSqliteDatabase } from '#db/client.ts';
import { runMigrations } from '#db/migrate.ts';

export async function withRecordTestDatabase<T>({
  run,
}: {
  run: (context: { database: SQL; dataFolder: string }) => Promise<T>;
}): Promise<T> {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-record-test-'));
  const database = await createSqliteDatabase({ dataFolder });

  try {
    await runMigrations({ db: database });
    return await run({ database, dataFolder });
  } finally {
    await database.close();
    await rm(dataFolder, { recursive: true, force: true });
  }
}
