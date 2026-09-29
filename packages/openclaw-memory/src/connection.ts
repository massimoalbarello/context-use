/** biome-ignore-all lint/complexity/useMaxParams: The Fetch API uses positional arguments. */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { auth } from '@modelcontextprotocol/client';
import {
  mutateConfigFile,
  readConfigFileSnapshotForWrite,
} from 'openclaw/plugin-sdk/config-mutation';
import { discoverTools, withClient } from './client';
import {
  assertPersonalConfiguration,
  prepareConfiguration,
  restoreConfiguration,
} from './configuration';
import { AUTHORIZATION_SCOPE, PLUGIN_ID, REQUEST_TIMEOUT_MS, serverUrl } from './contract';
import { ConnectionError } from './error';
import { attachmentDirectory, LearningStore, learningDatabase } from './learning-store';
import { authorizationResponse, oauthProvider } from './oauth';
import { assertNotRemoving } from './removal';
import type { ConnectionState } from './state';
import { readState, withConnection, writeState } from './state';

const authorizationFetch: NonNullable<Parameters<typeof auth>[1]['fetchFn']> = (url, init) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

async function activate(input: { directory: string; state: ConnectionState }): Promise<void> {
  try {
    input.state.tools = await withClient({ ...input, run: discoverTools });
  } catch {
    throw new ConnectionError(
      'Authorization was saved, but the MCP server did not verify memory access. Check the server URL and client access in Context Use Settings, then run reconnect to authorize a fresh connection. The previous memory settings have not been replaced.',
    );
  }
  input.state.learningId ??= randomUUID();
  await mutateConfigFile({
    afterWrite: { mode: 'none', reason: 'Context Use setup requests gateway refresh after commit' },
    mutate: async (config) => {
      prepareConfiguration({ config, state: input.state });
      // Write the restoration journal before committing host configuration. A crash can
      // leave unapplied entries, which disconnect safely ignores.
      await writeState(input);
    },
  });
}

async function removeLearningData(input: {
  directory: string;
  connectionId: string;
}): Promise<void> {
  await rm(join(input.directory, attachmentDirectory(input.connectionId)), {
    recursive: true,
    force: true,
  });
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    await rm(join(input.directory, `${learningDatabase(input.connectionId)}${suffix}`), {
      force: true,
    });
  }
}

export async function connect(input: {
  directory: string;
  instance: string;
  agentId: string;
  reauthorize?: boolean;
}): Promise<{ authorizationUrl?: string }> {
  const config = { serverUrl: serverUrl(input.instance), agentId: input.agentId };
  return await withConnection({
    directory: input.directory,
    run: async () => {
      await assertNotRemoving(input.directory);
      const existing = await readState(input.directory);
      if (existing && existing.config.agentId !== config.agentId) {
        throw new ConnectionError('Disconnect the existing account before changing agent.');
      }
      const state: ConnectionState = existing ?? { config, changes: [], tools: [], oauth: {} };
      const { snapshot } = await readConfigFileSnapshotForWrite();
      if (!snapshot.valid) {
        throw new ConnectionError('OpenClaw configuration is invalid. Run openclaw doctor first.');
      }
      assertPersonalConfiguration({ config: snapshot.config, state });
      if (input.reauthorize || state.config.serverUrl !== config.serverUrl) {
        const previousLearningId = state.learningId;
        state.config = config;
        state.oauth = {};
        state.tools = [];
        delete state.learningId;
        await writeState({ directory: input.directory, state });
        if (previousLearningId) {
          await removeLearningData({
            directory: input.directory,
            connectionId: previousLearningId,
          });
        }
      }
      await writeState({ directory: input.directory, state });
      const result = await auth(
        oauthProvider({ directory: input.directory, state, interactive: true }),
        {
          serverUrl: config.serverUrl,
          scope: AUTHORIZATION_SCOPE,
          fetchFn: authorizationFetch,
        },
      );
      if (result === 'REDIRECT') {
        return { authorizationUrl: state.oauth.pending?.url };
      }
      await activate({ directory: input.directory, state });
      return {};
    },
  });
}

export async function finishAuthorization(input: {
  directory: string;
  redirectUrl: string;
}): Promise<void> {
  await withConnection({
    directory: input.directory,
    run: async () => {
      await assertNotRemoving(input.directory);
      const state = await readState(input.directory);
      if (!state) {
        throw new ConnectionError('Start connect before completing authorization.');
      }
      const response = authorizationResponse({
        redirectUrl: input.redirectUrl,
        pending: state.oauth.pending,
      });
      const result = await auth(
        oauthProvider({ directory: input.directory, state, interactive: true }),
        {
          serverUrl: state.config.serverUrl,
          ...response,
          fetchFn: authorizationFetch,
        },
      );
      if (result !== 'AUTHORIZED') {
        throw new ConnectionError('Authorization was not completed. Start connect again.');
      }
      delete state.oauth.pending;
      delete state.oauth.verifier;
      // A new authorization can belong to another person even when the OAuth client is reused.
      const previousLearningId = state.learningId;
      state.learningId = randomUUID();
      await writeState({ directory: input.directory, state });
      if (previousLearningId) {
        await removeLearningData({
          directory: input.directory,
          connectionId: previousLearningId,
        });
      }
      await activate({ directory: input.directory, state });
    },
  });
}

export async function disconnect(directory: string): Promise<{ preserved: string[] }> {
  return await withConnection({
    directory,
    run: async () => {
      const state = await readState(directory);
      // Delete credentials first even if restoring configuration fails. Keep the journal
      // until restoration succeeds so this operation can be retried safely.
      if (state) {
        state.oauth = {};
        await writeState({ directory, state });
      }
      let preserved: string[] = [];
      await mutateConfigFile({
        afterWrite: {
          mode: 'none',
          reason: 'Context Use setup requests gateway refresh after cleanup',
        },
        // Removing only journal-owned settings can legitimately shrink a fresh config by over half.
        writeOptions: { allowConfigSizeDrop: true },
        mutate: (config) => {
          if (state) {
            preserved = restoreConfiguration({ config, state });
          }
        },
      });
      await rm(directory, { recursive: true, force: true });
      return { preserved };
    },
  });
}

export async function status(directory: string): Promise<Record<string, unknown>> {
  return await withConnection({
    directory,
    run: async () => {
      const state = await readState(directory);
      if (!state) {
        return { connected: false };
      }
      if (!state.oauth.tokens) {
        return {
          connected: false,
          authorizationPending: Boolean(state.oauth.pending),
          ...state.config,
        };
      }
      let tools: ConnectionState['tools'];
      try {
        tools = await withClient({ directory, state, run: discoverTools });
      } catch {
        return {
          connected: false,
          authenticated: false,
          ...state.config,
          error:
            'MCP access could not be verified. Check the server and run reconnect to authorize a fresh connection.',
        };
      }
      const { snapshot } = await readConfigFileSnapshotForWrite();
      const selected =
        snapshot.config.plugins?.slots?.memory === PLUGIN_ID &&
        snapshot.config.plugins?.entries?.[PLUGIN_ID]?.enabled === true;
      const learning =
        state.learningId && existsSync(join(directory, learningDatabase(state.learningId)))
          ? new LearningStore({
              directory,
              config: state.config,
              connectionId: state.learningId,
            })
          : undefined;
      try {
        return {
          connected: selected,
          authenticated: true,
          ...state.config,
          tools: tools.length,
          learning: {
            enabled: Boolean(state.learningId),
            ...(learning?.status() ?? { pending: 0, running: false }),
          },
        };
      } finally {
        learning?.close();
      }
    },
  });
}
