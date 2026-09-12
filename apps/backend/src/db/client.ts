import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { SQL } from 'bun';
import { ensureDir } from '#lib/filesystem.ts';

const DATABASE_FILE_NAME = 'app.db';

/** A separate connection keeps retrieval outside canonical write transactions. */
export function createSqliteReader({ dataFolder }: { dataFolder: string }): SQL {
  return new SQL({
    adapter: 'sqlite',
    filename: join(dataFolder, DATABASE_FILE_NAME),
    readonly: true,
  });
}

export async function createSqliteDatabase({ dataFolder }: { dataFolder: string }): Promise<SQL> {
  ensureDir(dataFolder);
  const database = new SQL({
    adapter: 'sqlite',
    filename: join(dataFolder, DATABASE_FILE_NAME),
  });

  try {
    // SQLite defaults this off per connection, leaving every `on delete cascade` decorative.
    // The sqlite adapter holds a single connection, so once here covers every query.
    await database.unsafe('PRAGMA foreign_keys = ON');
    return database;
  } catch (error) {
    await database.close();
    throw error;
  }
}

/** A short synchronous writer for background publications; callers retry contention between transactions. */
export function createSynchronousSqliteDatabase({ dataFolder }: { dataFolder: string }): Database {
  ensureDir(dataFolder);
  const database = new Database(join(dataFolder, DATABASE_FILE_NAME));
  database.exec('PRAGMA foreign_keys = ON');
  return database;
}
