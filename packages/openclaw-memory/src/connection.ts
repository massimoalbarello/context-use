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
import { PLUGIN_ID, REQUEST_TIMEOUT_MS, serverUrl } from './contract';
import { ConnectionError } from './error';
import { attachmentDirectory, LearningStore, learningDatabase } from './learning-store';
import { authorizationResponse, oauthProvider } from './oauth';
import type { ConnectionState } from './state';
import { readState, withConnection, writeState } from './state';

async function activate(input: { directory: string; state: ConnectionState }): Promise<void> {
  input.state.tools = await withClient({ ...input, run: discoverTools });
  input.state.learningId ??= randomUUID();
  await mutateConfigFile({
    mutate: async (config) => {
      prepareConfiguration({ config, state: input.state });
      // Write the restoration journal before committing host configuration. A crash can
      // leave unapplied entries, which disconnect safely ignores.
      await writeState(input);
    },
  });
}

export async function connect(input: {
  directory: string;
  instance: string;
  agentId: string;
}): Promise<{ authorizationUrl?: string }> {
  const config = { serverUrl: serverUrl(input.instance), agentId: input.agentId };
  return await withConnection({
    directory: input.directory,
    run: async () => {
      const existing = await readState(input.directory);
      if (
        existing &&
        (existing.config.serverUrl !== config.serverUrl ||
          existing.config.agentId !== config.agentId)
      ) {
        throw new ConnectionError(
          'Disconnect the existing account before changing instance or agent.',
        );
      }
      const state: ConnectionState = existing ?? { config, changes: [], tools: [], oauth: {} };
      const { snapshot } = await readConfigFileSnapshotForWrite();
      if (!snapshot.valid) {
        throw new ConnectionError('OpenClaw configuration is invalid. Run openclaw doctor first.');
      }
      assertPersonalConfiguration({ config: snapshot.config, state });
      await writeState({ directory: input.directory, state });
      const result = await auth(
        oauthProvider({ directory: input.directory, state, interactive: true }),
        {
          serverUrl: config.serverUrl,
          scope: 'mcp offline_access',
          fetchFn: (url, init) =>
            fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
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
          fetchFn: (url, init) =>
            fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
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
        await rm(join(input.directory, attachmentDirectory(previousLearningId)), {
          recursive: true,
          force: true,
        });
        for (const suffix of ['', '-journal']) {
          await rm(join(input.directory, `${learningDatabase(previousLearningId)}${suffix}`), {
            force: true,
          });
        }
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
        // Removing only journal-owned settings can legitimately shrink a fresh config by over half.
        writeOptions: { allowConfigSizeDrop: true },
        mutate: (config) => {
          if (state) {
            preserved = restoreConfiguration({ config, state });
          }
        },
      });
      await rm(join(directory, 'connection.json'), { force: true });
      if (state?.learningId) {
        await rm(join(directory, attachmentDirectory(state.learningId)), {
          recursive: true,
          force: true,
        });
        for (const suffix of ['', '-journal']) {
          await rm(join(directory, `${learningDatabase(state.learningId)}${suffix}`), {
            force: true,
          });
        }
      }
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
      const tools = await withClient({ directory, state, run: discoverTools });
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
