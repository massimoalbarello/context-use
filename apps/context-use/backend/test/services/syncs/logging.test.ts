import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpenSyncOptions } from '@context-use/open-sync';
import { createSyncRuntime } from '@context-use/open-sync/engine';
import { syncEventLogger } from '#backend/services/syncs/logging.ts';
import { githubPullRequests } from '#backend/services/syncs/sources/github/pull-requests.ts';
import { page } from './github-fixture.ts';

type Event = Parameters<NonNullable<OpenSyncOptions['onEvent']>>[0];

test('SDK logs identify the owner and sync, distinguish request errors, and survive a broken log sink', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'context-use-sync-logging-'));
  const logs: { level: string; event: Event }[] = [];
  let fail = true;
  const runtime = createSyncRuntime({
    databasePath: join(directory, 'sync.db'),
    definitions: [githubPullRequests],
    destinationTypes: {
      local: {
        configSchema: { type: 'object' },
        deliver: () => Promise.resolve({ status: 'accepted' }),
      },
    },
    onEvent: syncEventLogger({
      info: (line) => {
        logs.push({ level: 'info', event: JSON.parse(String(line)) });
        throw new Error('Unavailable log sink');
      },
      error: (line) => {
        logs.push({ level: 'error', event: JSON.parse(String(line)) });
        throw new Error('Unavailable log sink');
      },
    }),
    connector: {
      bind: async () => ({
        action: () => Promise.reject(new Error('Unexpected action')),
        get: () => Promise.reject(new Error('Unexpected GET')),
        post: () =>
          Promise.resolve({
            status: 200,
            headers: {},
            body: fail ? { errors: [{ type: 'RATE_LIMITED' }] } : page(),
          }),
      }),
    },
  });
  const scope = { actorId: 'owner', ownerId: 'owner' };
  try {
    const sync = await runtime.api.createSync({
      ...scope,
      definition: githubPullRequests.definition.id,
      connection: { id: 'connection', service: 'github' },
      destination: { type: 'local', input: {} },
      config: {},
    });
    await runtime.tick();
    expect(logs).toContainEqual({
      level: 'error',
      event: expect.objectContaining({
        code: 'source_http_429',
        ownerId: scope.ownerId,
        syncId: sync.id,
        fields: expect.objectContaining({ httpStatus: 429 }),
      }),
    });
    fail = false;
    runtime.api.runNow({ ...scope, id: sync.id });
    await runtime.tick();
    expect(runtime.api.syncs(scope)[0]?.status).toBe('succeeded');
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
