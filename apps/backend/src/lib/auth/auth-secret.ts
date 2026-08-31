import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureDir } from '#lib/filesystem.ts';

const AUTH_SECRET_BYTES = 32;
const AUTH_SECRET_FILE_NAME = '.better-auth-secret';
const PRIVATE_FILE_MODE = 0o600;

type AuthSecretSource =
  | { kind: 'environment' }
  | { kind: 'stored-file'; path: string }
  | { kind: 'generated-file'; path: string };

export type AuthSecret = {
  value: string;
  source: AuthSecretSource;
};

export async function loadAuthSecret({
  dataFolder,
  environmentSecret,
}: {
  dataFolder: string;
  environmentSecret: string | undefined;
}): Promise<AuthSecret> {
  if (environmentSecret) {
    return { value: environmentSecret, source: { kind: 'environment' } };
  }

  ensureDir(dataFolder);
  const path = join(dataFolder, AUTH_SECRET_FILE_NAME);
  const stored = await readStoredSecret(path);
  if (stored !== undefined) {
    return { value: stored, source: { kind: 'stored-file', path } };
  }

  const generated = randomBytes(AUTH_SECRET_BYTES).toString('hex');
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
    throw new Error(`Auth secret file is empty: ${path}`);
  }
  return secret;
}

function hasCode({ error, code }: { error: unknown; code: string }): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
