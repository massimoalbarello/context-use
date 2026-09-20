import { defineRecordSync, type SyncProvider } from '#backend/services/syncs/catalog.ts';
import { now } from './github-fixture.ts';

export function fixtureProvider(id: string): SyncProvider {
  return {
    id,
    name: id,
    description: `Records from ${id}`,
    oauth: { createAppUrl: `https://${id}.example/apps`, authorizationOptionIds: ['read'] },
    syncs: [
      defineRecordSync({
        key: `${id}-events`,
        name: 'Events',
        description: 'Calendar events',
        intervalMs: 60_000,
        kinds: ['event'],
        definition: {
          id: `${id}.events`,
          version: '1',
          artifactId: `${id}/events/1`,
          configSchema: { type: 'object' },
          checkpointSchema: { type: 'object' },
          initialCheckpoint: {},
          provider: { service: id, actions: [] },
        },
        async *run() {
          yield await Promise.resolve({
            complete: true,
            checkpoint: { complete: true },
            deliverable: {
              records: [
                {
                  operation: 'upsert',
                  kind: 'event',
                  id: 'event-one',
                  data: {
                    title: `${id} event`,
                    body: '# Event\n\nMeeting notes.',
                    sourceUpdatedAt: now,
                    source: { provider: id, kind: 'event', id: 'event-one' },
                    occurredAt: now,
                  },
                },
              ],
            },
          });
        },
      }),
    ],
  };
}
