import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpenSyncOptions } from '@context-use/open-sync';
import { createSyncRuntime } from '@context-use/open-sync/engine';
import { syncEventLogger } from '#backend/services/syncs/logging.ts';
import { githubPullRequests } from '#backend/services/syncs/providers/github/pull-requests.ts';
import { page } from './github-fixture.ts';

type Event = Parameters<NonNullable<OpenSyncOptions['onEvent']>>[0];

test('SDK logs identify the owner and installation, distinguish request errors, and survive a broken log sink', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'context-use-sync-logging-'));
  const logs: { level: string; event: Event }[] = [];
  let fail = true;
  const runtime = createSyncRuntime({
    databasePath: join(directory, 'sync.db'),
    definitions: [githubPullRequests.registration],
    destinationTypes: {
      local: {
        version: '1',
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
    const destination = runtime.api.createDestination({ ...scope, type: 'local', config: {} });
    const installation = await runtime.api.createInstallation({
      ...scope,
      definition: githubPullRequests.registration.definition,
      connection: { id: 'connection', service: 'github' },
      destinationId: destination.id,
      config: {},
    });
    await runtime.tick();
    expect(logs).toContainEqual({
      level: 'error',
      event: expect.objectContaining({
        code: 'definition_log',
        ownerId: scope.ownerId,
        installationId: installation.id,
        fields: expect.objectContaining({
          outcome: 'graphql_error',
          errors: [{ type: 'RATE_LIMITED' }],
        }),
      }),
    });
    expect(logs).toContainEqual({
      level: 'error',
      event: { code: 'execution_failed', ownerId: scope.ownerId, installationId: installation.id },
    });
    fail = false;
    runtime.api.queueRun({ ...scope, id: installation.id });
    await runtime.tick();
    expect(runtime.api.installations(scope)[0]?.status).toBe('succeeded');
    expect(logs).toContainEqual({
      level: 'info',
      event: expect.objectContaining({
        ownerId: scope.ownerId,
        installationId: installation.id,
        fields: expect.objectContaining({ outcome: 'success' }),
      }),
    });
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
