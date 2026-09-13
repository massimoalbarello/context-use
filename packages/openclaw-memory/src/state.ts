import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
  Tool,
} from '@modelcontextprotocol/client';
import { resolveStateDir } from 'openclaw/plugin-sdk/state-paths';
import { lock } from 'proper-lockfile';
import { z } from 'zod';
import { PLUGIN_ID, PluginConfigSchema } from './contract';
import { ConnectionError } from './error';

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const LOCK_STALE_MS = 120_000;
const LOCK_RETRIES = 300;
const LOCK_RETRY_MS = 100;

export const ChangeSchema = z.object({
  path: z.array(z.string()).min(1),
  before: z.unknown().optional(),
  applied: z.unknown(),
});
export type Change = z.infer<typeof ChangeSchema>;

const ConnectionStateSchema = z.object({
  config: PluginConfigSchema,
  changes: z.array(ChangeSchema).default([]),
  tools: z
    .array(
      z
        .object({
          name: z.string().regex(/^[a-z][a-z0-9_]*$/),
          inputSchema: z.object({ type: z.literal('object') }).passthrough(),
        })
        .passthrough(),
    )
    .default([]),
  oauth: z
    .object({
      client: z.record(z.string(), z.unknown()).optional(),
      tokens: z.record(z.string(), z.unknown()).optional(),
      discovery: z.record(z.string(), z.unknown()).optional(),
      verifier: z.string().optional(),
      pending: z.object({ url: z.url(), state: z.string(), createdAt: z.number() }).optional(),
    })
    .default({}),
});

export type ConnectionState = {
  config: z.infer<typeof PluginConfigSchema>;
  changes: Change[];
  tools: Tool[];
  oauth: {
    client?: StoredOAuthClientInformation;
    tokens?: StoredOAuthTokens;
    discovery?: OAuthDiscoveryState;
    verifier?: string;
    pending?: { url: string; state: string; createdAt: number };
  };
};

export function connectionDirectory(): string {
  return join(resolveStateDir(), 'plugins', PLUGIN_ID);
}

export async function readState(directory: string): Promise<ConnectionState | undefined> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(directory, 'connection.json'), 'utf8'));
    return ConnectionStateSchema.parse(raw) as ConnectionState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw new ConnectionError(
      'Context Use connection state is unreadable. Restore its backup before reconnecting.',
    );
  }
}

export async function writeState(input: {
  directory: string;
  state: ConnectionState;
}): Promise<void> {
  const path = join(input.directory, 'connection.json');
  // Callers hold the connection lock. Reusing this path also replaces credentials
  // left by an interrupted write when disconnect writes the cleared OAuth state.
  const temporary = `${path}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(input.state), { mode: PRIVATE_FILE_MODE });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

// The same cross-process lock covers refresh and disconnect, so a pending request cannot
// restore deleted credentials or consume a rotating refresh token in two processes.
export async function withConnection<T>(input: {
  directory: string;
  run: () => Promise<T>;
}): Promise<T> {
  await mkdir(input.directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const release = await lock(input.directory, {
    stale: LOCK_STALE_MS,
    retries: { retries: LOCK_RETRIES, minTimeout: LOCK_RETRY_MS, maxTimeout: LOCK_RETRY_MS },
  });
  try {
    return await input.run();
  } finally {
    await release();
  }
}

export function readStateSync(directory: string): ConnectionState | undefined {
  try {
    return ConnectionStateSchema.parse(
      JSON.parse(readFileSync(join(directory, 'connection.json'), 'utf8')),
    ) as ConnectionState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw new ConnectionError('Context Use connection state is unreadable.');
  }
}
