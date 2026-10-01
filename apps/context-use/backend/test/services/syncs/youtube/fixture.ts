import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderOperations, SyncRegistration } from '@context-use/open-sync/definition';
import type { Deliverable } from '@context-use/open-sync/delivery';
import { createSyncRuntime } from '@context-use/open-sync/engine';
import type { JsonObject } from '@context-use/open-sync/json';

export const owner = { actorId: 'alice', ownerId: 'alice' };
export const unused = () => Promise.reject(new Error('Unexpected provider operation'));

export async function fixture(input: {
  registration: SyncRegistration;
  provider: ProviderOperations;
  config?: JsonObject;
}) {
  const directory = await mkdtemp(join(tmpdir(), 'example-sync-'));
  const deliveries: Deliverable[] = [];
  const options = {
    databasePath: join(directory, 'sync.db'),
    definitions: [input.registration],
    connector: { bind: () => Promise.resolve(input.provider) },
    destinationTypes: {
      test: {
        configSchema: { type: 'object' as const },
        deliver: ({ deliverable: delivery }: { deliverable: Deliverable }) => {
          deliveries.push(delivery);
          return Promise.resolve({ status: 'accepted' as const });
        },
      },
    },
  };
  let engine = createSyncRuntime(options);
  const destination = { type: 'test', input: {} };
  const sync = await engine.api.createSync({
    ...owner,
    definition: input.registration.definition.id,
    connection: { id: 'connection', service: input.registration.definition.provider!.service },
    config: input.config ?? {},
    destination,
  });
  const resource = { ...owner, id: sync.id };
  return {
    deliveries,
    get engine() {
      return engine;
    },
    get saved() {
      const db = new Database(options.databasePath, { readonly: true });
      try {
        const row = db
          .query<{ checkpoint: string }, string[]>(
            'SELECT checkpoint FROM syncs WHERE owner_id=? AND id=?',
          )
          .get(owner.ownerId, sync.id)!;
        return {
          ...engine.api.sync({ ...owner, id: sync.id }),
          checkpoint: JSON.parse(row.checkpoint),
        };
      } finally {
        db.close();
      }
    },
    get records() {
      return deliveries.flatMap((delivery) => delivery.records);
    },
    queue() {
      engine.api.runNow(resource);
    },
    async finish() {
      const maxTicks = 30;
      for (let tick = 0; tick < maxTicks; tick++) {
        await engine.tick();
        if (engine.api.sync(resource).errorCode === 'execution_failed') {
          throw new Error('Example acquisition failed');
        }
        if (
          engine.api.sync(resource).status === 'succeeded' &&
          !engine.api.status(owner).queue.pendingRecords
        ) {
          return;
        }
      }
      throw new Error('Example did not finish');
    },
    async restart() {
      await engine.close();
      engine = createSyncRuntime(options);
    },
    async close() {
      await engine.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
