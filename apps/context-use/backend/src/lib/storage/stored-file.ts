import type { Storage } from './storage.ts';

/** Check availability without buffering the stored file before streaming it. */
export async function readStoredFile({
  storage,
  storageKey,
  sizeBytes,
  label,
}: {
  storage: Storage;
  storageKey: string;
  sizeBytes: number;
  label: string;
}): Promise<Blob> {
  if (!(await storage.exists(storageKey))) {
    throw new Error(`${label} is missing`);
  }
  if ((await storage.size(storageKey)) !== sizeBytes) {
    throw new Error(`${label} failed its size check`);
  }
  return storage.file(storageKey);
}
