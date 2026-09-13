import type { Storage } from '@repo/backend/lib/storage/storage';

export function readOnlyStorage(storage: Storage): Storage {
  const deny = () => Promise.reject(new Error('Public demo storage is read-only'));
  return {
    file: (key) => storage.file(key),
    exists: (key) => storage.exists(key),
    size: (key) => storage.size(key),
    write: deny,
    delete: deny,
  };
}
