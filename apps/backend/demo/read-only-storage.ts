import type { Storage } from '#lib/storage/storage.ts';

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
