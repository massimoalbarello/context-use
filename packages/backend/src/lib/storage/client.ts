import { join } from 'node:path';
import { LocalStorage } from '#lib/storage/local-storage.ts';
import type { StorageClient } from '#lib/storage/storage.ts';

const OBJECTS_FOLDER_NAME = 'objects';

export function createLocalStorage({ dataFolder }: { dataFolder: string }): StorageClient {
  return new LocalStorage(join(dataFolder, OBJECTS_FOLDER_NAME));
}
