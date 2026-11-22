import type { ProviderApi } from '@context-use/open-sync';
import type { JsonObject } from '@context-use/open-sync/json';
import type { SyncProvider } from '#backend/services/syncs/catalog.ts';
import { now } from './github-fixture.ts';

export function fixtureProvider(id: string): SyncProvider {
  const data: JsonObject =
    id === 'alpha' ? { title: 'Opaque provider data', url: 'not a URL' } : {};
  return {
    id,
    name: id,
    description: `Records from ${id}`,
    oauth: { createAppUrl: `https://${id}.example/apps`, authorizationOptionIds: ['read'] },
    syncs: [
      {
        name: 'Events',
        description: 'Calendar events',
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
                  data,
                  preview: `${id}   event`,
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

export function connectedProviders(
  connections: {
    id: string;
    service: string;
    account: string;
    status: string;
    authType: 'oauth2';
  }[],
): ProviderApi {
  function unexpected(): never {
    throw new Error('Unexpected provider call');
  }
  return {
    credentials: unexpected,
    configure: unexpected,
    start: unexpected,
    connection: unexpected,
    catalog: unexpected,
    connections: () => Promise.resolve(connections),
    status: ({ service }) =>
      Promise.resolve({
        provider: {
          service,
          displayName: service,
          iconUrl: null,
          categories: [],
          scenario: '',
          authTypes: ['oauth2'],
        },
        setup: {
          service,
          auth: [],
          oauthClient: {
            configured: true,
            customClientAvailable: false,
            expectedRedirectUri: 'https://host/api/open-sync/oauth/callback',
            missingFields: [],
          },
        },
        connections: connections.filter((connection) => connection.service === service),
      }),
  };
}
