import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SQL } from 'bun';
import { createSqliteDatabase } from '#db/client.ts';
import { runMigrations } from '#db/migrate.ts';

export async function withAuthTestDatabase<T>({
  run,
}: {
  run: (database: SQL) => Promise<T>;
}): Promise<T> {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-auth-test-'));
  const database = await createSqliteDatabase({ dataFolder });

  try {
    await runMigrations({ db: database });
    return await run(database);
  } finally {
    await database.close();
    await rm(dataFolder, { recursive: true, force: true });
  }
}
