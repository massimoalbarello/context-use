import { rename, rm, writeFile } from 'node:fs/promises';

export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

/** Callers serialize writes with their resource lock; retries replace an interrupted temporary file. */
export async function writePrivateFile(input: {
  path: string;
  data: string | Uint8Array;
}): Promise<void> {
  const temporary = `${input.path}.tmp`;
  try {
    await writeFile(temporary, input.data, { mode: PRIVATE_FILE_MODE });
    await rename(temporary, input.path);
  } finally {
    await rm(temporary, { force: true });
  }
}
