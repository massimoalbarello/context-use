import type { StorageClient } from './storage.ts';

export async function readVerifiedText({
  storage,
  key,
  contentHash,
}: {
  storage: StorageClient;
  key: string;
  contentHash: string;
}): Promise<string> {
  if (!(await storage.exists(key))) {
    throw new Error('Stored text blob is missing');
  }
  const text = await storage.file(key).text();
  if (new Bun.CryptoHasher('sha256').update(text).digest('hex') !== contentHash) {
    throw new Error('Stored text blob failed its integrity check');
  }
  return text;
}
