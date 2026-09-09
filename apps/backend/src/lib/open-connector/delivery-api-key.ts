import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureDir } from '#lib/filesystem.ts';
import { OPEN_CONNECTOR_INTEGRATION_ID_PATTERN } from '#models/open-connector/model.ts';

const DELIVERY_API_KEY_BYTES = 32;
const PRIVATE_FILE_MODE = 0o600;

export type OpenConnectorDeliveryApiKeySource =
  | { kind: 'environment' }
  | { kind: 'stored-file'; path: string }
  | { kind: 'generated-file'; path: string };

export type OpenConnectorDeliveryApiKey = {
  value: string;
  source: OpenConnectorDeliveryApiKeySource;
};

export function openConnectorDeliveryApiKeyFileName(integrationId: string): string {
  if (!OPEN_CONNECTOR_INTEGRATION_ID_PATTERN.test(integrationId)) {
    throw new Error('Invalid open-connector integration ID for delivery API key storage.');
  }
  return `.open-connector-integration-${integrationId}.api-key`;
}

/**
 * Loads an integration-owned delivery API key candidate.
 *
 * An operator-supplied value wins. Otherwise the first caller creates a private file in the
 * durable data folder, while concurrent and later callers reuse that same value. The durable
 * integration fingerprint decides whether an existing integration may actually use the candidate.
 */
export async function loadOpenConnectorDeliveryApiKey({
  dataFolder,
  integrationId,
  environmentValue,
}: {
  dataFolder: string;
  integrationId: string;
  environmentValue: string | undefined;
}): Promise<OpenConnectorDeliveryApiKey> {
  if (environmentValue) {
    return { value: environmentValue, source: { kind: 'environment' } };
  }

  ensureDir(dataFolder);
  const path = join(dataFolder, openConnectorDeliveryApiKeyFileName(integrationId));
  const stored = await readStoredSecret(path);
  if (stored !== undefined) {
    return { value: stored, source: { kind: 'stored-file', path } };
  }

  const generated = randomBytes(DELIVERY_API_KEY_BYTES).toString('base64url');
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
    throw new Error(`Open-connector delivery API key file is empty: ${path}`);
  }
  return secret;
}

function hasCode({ error, code }: { error: unknown; code: string }): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
