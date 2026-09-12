import { expect, test } from 'bun:test';
import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { elysiaErrorHandler } from '#lib/errors.ts';
import type { HypermediaRetrievalResults } from '#models/hypermedia-retrieval/model.ts';
import { temporalBoundsFrom } from '#models/knowledge-pages/temporal-coverage.ts';
import { createHypermediaSearchController } from '#routes/api/hypermedia/search/controller.ts';
import type { HypermediaRetrievalServiceContract } from '#services/hypermedia-retrieval/service.ts';
import { unusedMcpProtection } from '../../support/mcp.ts';
import { expectNoInternalResourceIds } from '../../support/public-api.ts';

const timestamp = '2026-01-01T00:00:00.000Z';

function searchApp(retrievalService: Pick<HypermediaRetrievalServiceContract, 'search'>) {
  const auth: Auth = {
    handler: async () => new Response(null, { status: StatusMap['Not Found'] }),
    protectMcpRequest: unusedMcpProtection,
    getSession: ({ headers }) => {
      const ownerId = headers.get('test-owner');
      if (!ownerId) {
        return Promise.resolve(null);
      }
      const date = new Date(timestamp);
      return Promise.resolve({
        user: {
          id: ownerId,
          name: 'Owner',
          email: 'owner@example.com',
          emailVerified: true,
          createdAt: date,
          updatedAt: date,
        },
        session: {
          id: 'session',
          userId: ownerId,
          token: 'token',
          expiresAt: date,
          createdAt: date,
          updatedAt: date,
        },
      });
    },
  };
  return new Elysia()
    .onError(elysiaErrorHandler)
    .use(createHypermediaSearchController({ auth, retrievalService }));
}

test('HTTP search maps pipeline results to compact typed previews without internal identifiers', async () => {
  const dates = { createdAt: timestamp, updatedAt: timestamp };
  const result: HypermediaRetrievalResults = {
    results: [
      {
        resourceType: 'entity',
        matchExcerpt: 'Researches retrieval.',
        entity: {
          id: 'private-entity-id',
          readableId: 'luca',
          name: 'Luca',
          description: 'Researches retrieval.',
          entityType: 'person',
          isSelf: false,
          image: null,
          ...dates,
        },
      },
      {
        resourceType: 'knowledge_page',
        matchExcerpt: 'A sentence deep in the page.',
        knowledgePage: {
          id: 'private-page-id',
          readableId: 'research',
          title: 'Research',
          excerpt: 'An overview.',
          temporalCoverage: '2026',
          revisionNumber: 1,
          ...dates,
        },
      },
      {
        resourceType: 'asset',
        matchExcerpt: null,
        asset: {
          id: 'private-asset-id',
          readableId: 'chart',
          name: 'Chart',
          mediaType: 'image/png',
          extension: 'png',
          sizeBytes: 42,
          ...dates,
        },
      },
      {
        resourceType: 'record',
        matchExcerpt: 'The meeting discusses retrieval.',
        record: {
          readableId: 'meeting',
          title: 'Meeting',
          provider: 'granola',
          kind: 'meeting',
          recordId: 'source-meeting',
          sync: { readableId: 'notes', name: 'Notes' },
          participantNames: ['Luca'],
          sourceCreatedAt: timestamp,
          sourceUpdatedAt: null,
          ...dates,
        },
      },
    ],
    totalMatches: 8,
    truncated: true,
  };
  const app = searchApp({ search: async () => result });
  const response = await app.handle(
    new Request('http://localhost/hypermedia/search?query=research', {
      headers: { 'test-owner': 'owner-a' },
    }),
  );
  expect(response.status).toBe(StatusMap.OK);
  const body = await response.json();
  expect(body).toMatchObject({
    totalMatches: 8,
    truncated: true,
    results: [
      {
        resourceType: 'entity',
        address: 'context-use://entity/luca',
        entity: { readableId: 'luca', entityType: 'person' },
      },
      {
        resourceType: 'knowledge_page',
        address: 'context-use://page/research',
        matchExcerpt: 'A sentence deep in the page.',
      },
      { resourceType: 'asset', address: 'context-use://asset/chart' },
      {
        resourceType: 'record',
        address: 'context-use://record/meeting',
        record: { participantNames: ['Luca'], provider: 'granola', kind: 'meeting' },
      },
    ],
  });
  expectNoInternalResourceIds(body);
  expect(JSON.stringify(body)).not.toContain('private-');
});

test('HTTP search passes the authenticated owner and typed narrowing filters to the shared pipeline', async () => {
  const app = searchApp({
    search: (input) => {
      expect(input).toEqual({
        ownerId: 'owner-b',
        query: 'project',
        resourceTypes: ['knowledge_page', 'record'],
        limit: 7,
        filters: {
          entityType: undefined,
          knowledgePage: { interval: 'with', temporalBounds: temporalBoundsFrom('2026') },
          asset: { kind: 'entity_image' },
          record: {
            provider: 'granola',
            kind: 'meeting',
            participantName: 'Luca',
            createdFrom: '2026-01-01T00:00:00.000Z',
            createdTo: '2026-02-01T00:00:00.000Z',
            updatedFrom: '2026-03-01T00:00:00.000Z',
            updatedTo: '2026-04-01T00:00:00.000Z',
          },
        },
      });
      return Promise.resolve({ results: [], totalMatches: 0, truncated: false });
    },
  });
  const query = new URLSearchParams({
    query: 'project',
    resourceTypes: 'knowledge_page,record',
    limit: '7',
    interval: 'with',
    time: '2026',
    assetKind: 'entity_image',
    recordProvider: ' granola ',
    recordKind: ' meeting ',
    participantName: ' Luca ',
    recordCreatedFrom: '2025-12-31T19:00:00-05:00',
    recordCreatedTo: '2026-02-01T00:00:00Z',
    recordUpdatedFrom: '2026-03-01T00:00:00Z',
    recordUpdatedTo: '2026-04-01T00:00:00Z',
  });
  const response = await app.handle(
    new Request(`http://localhost/hypermedia/search?${query}`, {
      headers: { 'test-owner': 'owner-b' },
    }),
  );
  expect(response.status).toBe(StatusMap.OK);
  expect(await response.json()).toEqual({ results: [], totalMatches: 0, truncated: false });
});

test('HTTP search rejects unauthenticated or invalid queries before reaching the pipeline', async () => {
  const app = searchApp({
    search: () => {
      throw new Error('Unexpected retrieval');
    },
  });
  const unauthorized = await app.handle(
    new Request('http://localhost/hypermedia/search?query=research'),
  );
  expect(unauthorized.status).toBe(StatusMap.Unauthorized);
  for (const query of [
    '',
    'query=%20',
    'query=research&entityType=event',
    'query=research&entityType=person,place',
    'query=research&limit=0',
    'query=research&limit=2.5',
    'query=research&limit=51',
    'query=research&resourceTypes=object',
    'query=research&resourceTypes=entity,object',
    'query=research&time=invalid',
    'query=research&recordKind=%20',
    'query=research&recordCreatedFrom=invalid',
    'query=research&recordCreatedFrom=2026-02-01&recordCreatedTo=2026-01-01',
    'query=research&recordUpdatedFrom=2026-01-01&recordUpdatedTo=2026-01-01',
  ]) {
    const response = await app.handle(
      new Request(`http://localhost/hypermedia/search?${query}`, {
        headers: { 'test-owner': 'owner-a' },
      }),
    );
    expect(response.status).toBe(StatusMap['Bad Request']);
  }
});

test('a source date alone restricts the shared pipeline to records', async () => {
  const app = searchApp({
    search: (input) => {
      expect(input.filters?.record).toMatchObject({ createdFrom: '2026-01-01T00:00:00.000Z' });
      return Promise.resolve({ results: [], totalMatches: 0, truncated: false });
    },
  });
  const response = await app.handle(
    new Request('http://localhost/hypermedia/search?query=research&recordCreatedFrom=2026-01-01', {
      headers: { 'test-owner': 'owner-a' },
    }),
  );
  expect(response.status).toBe(StatusMap.OK);
});
