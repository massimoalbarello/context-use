import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureDir } from '#lib/filesystem.ts';

const RECEIVER_SECRET_BYTES = 32;
export const OPEN_CONNECTOR_RECEIVER_SECRET_FILE_NAME = '.open-connector-receiver-token';
const PRIVATE_FILE_MODE = 0o600;

export type OpenConnectorReceiverSecretSource =
  | { kind: 'environment' }
  | { kind: 'stored-file'; path: string }
  | { kind: 'generated-file'; path: string };

export type OpenConnectorReceiverSecret = {
  value: string;
  source: OpenConnectorReceiverSecretSource;
};

/**
 * Loads a receiver-owned delivery credential candidate.
 *
 * An operator-supplied value wins. Otherwise the first caller creates a private file in the
 * durable data folder, while concurrent and later callers reuse that same value. The durable
 * integration fingerprint decides whether an existing receiver may actually use the candidate.
 */
export async function loadOpenConnectorReceiverSecret({
  dataFolder,
  environmentSecret,
}: {
  dataFolder: string;
  environmentSecret: string | undefined;
}): Promise<OpenConnectorReceiverSecret> {
  if (environmentSecret) {
    return { value: environmentSecret, source: { kind: 'environment' } };
  }

  ensureDir(dataFolder);
  const path = join(dataFolder, OPEN_CONNECTOR_RECEIVER_SECRET_FILE_NAME);
  const stored = await readStoredSecret(path);
  if (stored !== undefined) {
    return { value: stored, source: { kind: 'stored-file', path } };
  }

  const generated = randomBytes(RECEIVER_SECRET_BYTES).toString('base64url');
  try {
    await writeFile(path, generated, { encoding: 'utf8', flag: 'wx', mode: PRIVATE_FILE_MODE });
    return { value: generated, source: { kind: 'generated-file', path } };
  } catch (error) {
    if (!hasCode({ error, code: 'EEXIST' })) {
      throw error;
    }
    return { value: await requireStoredSecret(path), source: { kind: 'stored-file', path } };
  }
}

async function readStoredSecret(path: string): Promise<string | undefined> {
  try {
    return await requireStoredSecret(path);
  } catch (error) {
    if (hasCode({ error, code: 'ENOENT' })) {
      return undefined;
    }
    throw error;
  }
}

async function requireStoredSecret(path: string): Promise<string> {
  const secret = await readFile(path, 'utf8');
  if (!secret) {
    throw new Error(`Open-connector receiver token file is empty: ${path}`);
  }
  return secret;
}

function hasCode({ error, code }: { error: unknown; code: string }): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
