import type { Storage } from './storage.ts';

/** Read the exact immutable file selected by a repository, never its latest replacement. */
export async function readVerifiedText({
  storage,
  storageKey,
  contentHash,
  sizeBytes,
  label,
}: {
  storage: Storage;
  storageKey: string;
  contentHash: string;
  sizeBytes: number;
  label: string;
}): Promise<string> {
  if (!(await storage.exists(storageKey))) {
    throw new Error(`${label} is missing`);
  }
  const bytes = new Uint8Array(await storage.file(storageKey).arrayBuffer());
  if (
    bytes.byteLength !== sizeBytes ||
    new Bun.CryptoHasher('sha256').update(bytes).digest('hex') !== contentHash
  ) {
    throw new Error(`${label} failed its integrity check`);
  }
  return new TextDecoder().decode(bytes);
}
