import type { SyncProvider } from '#backend/services/syncs/catalog.ts';
import { now } from './github-fixture.ts';

export function fixtureProvider(id: string): SyncProvider {
  return {
    id,
    name: id,
    description: `Records from ${id}`,
    oauth: { createAppUrl: `https://${id}.example/apps`, authorizationOptionIds: ['read'] },
    syncs: [
      {
        key: `${id}-events`,
        name: 'Events',
        description: 'Calendar events',
        intervalMs: 60_000,
        registration: {
          definition: {
            id: `${id}.events`,
            configSchema: { type: 'object' },
            checkpointSchema: { type: 'object' },
            initialCheckpoint: {},
            kinds: { event: { type: 'object' } },
            provider: { service: id, actions: [] },
          },
          load: () => ({
            step: async () => ({
              complete: true,
              checkpoint: {},
              records: [
                {
                  operation: 'upsert',
                  kind: 'event',
                  id: 'event-one',
                  data: { title: `${id} event` },
                  content: { format: 'markdown', body: '# Event\n\nMeeting notes.' },
                  createdAt: now,
                  updatedAt: now,
                },
              ],
            }),
          }),
        },
      },
    ],
  };
}
