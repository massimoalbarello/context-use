import { afterEach, expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from '../../src/lib/auth';
import type { Asset } from '../../src/queries/assets';
import type { EntityDetail } from '../../src/queries/entities';
import type { KnowledgePage } from '../../src/queries/pages';
import { type KnowledgeProfile, profileQueryOptions } from '../../src/queries/profile';
import type { ExternalRecord } from '../../src/queries/records';
import { sessionQueryOptions } from '../../src/queries/session';
import { routeTree } from '../../src/routeTree.gen';

afterEach(cleanup);

async function renderResourceBrowser(path = '/pages') {
  const timestamp = new Date('2026-01-01T00:00:00Z');
  const entity: EntityDetail = {
    readableId: 'owner',
    name: 'Owner',
    description: 'Workspace owner',
    entityType: null,
    isSelf: true,
    image: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    pages: [],
  };
  const asset: Asset = {
    readableId: 'chart',
    name: 'Launch chart',
    mediaType: 'image/png',
    extension: 'png',
    sizeBytes: 1024,
    createdAt: timestamp,
    updatedAt: timestamp,
    usages: [],
    depicts: [],
  };
  const record: ExternalRecord = {
    readableId: 'research',
    title: 'Research notes',
    provider: 'notion',
    kind: 'note',
    sourceCreatedAt: null,
    sourceUpdatedAt: null,
    recordId: 'source-record',
    sync: { readableId: 'research-sync', name: 'Research sync' },
    createdAt: timestamp,
    updatedAt: timestamp,
    markdown: 'Research source content.',
    participantNames: [],
    backlinks: [],
  };
  const page: KnowledgePage = {
    readableId: 'launch',
    title: 'Launch plan',
    excerpt: 'Launch overview',
    temporalCoverage: null,
    revisionNumber: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    markdown:
      '# Launch plan\n\n[Owner](context-use://entity/owner) uses [chart](context-use://asset/chart) and [research](context-use://record/research).',
    mentions: [entity],
    recordReferences: [
      {
        readableId: record.readableId,
        title: record.title,
        provider: record.provider,
        kind: record.kind,
        available: true,
      },
    ],
    references: [],
    backlinks: [],
    assetUsages: [],
    revisions: [],
  };
  const session: Session = {
    session: {
      id: 'session',
      token: 'test',
      userId: 'owner',
      expiresAt: new Date('2099-01-01'),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    user: {
      id: 'owner',
      name: 'Owner',
      email: 'owner@example.com',
      emailVerified: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(sessionQueryOptions.queryKey, session);
  const profile: KnowledgeProfile = { selfEntity: entity };
  client.setQueryData(profileQueryOptions.queryKey, profile);
  let failedResource = false;
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (input: Parameters<typeof globalThis.fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : input);
        if (url.pathname === '/api/records/research' && failedResource) {
          return Promise.resolve(
            Response.json({ error: 'Record temporarily unavailable' }, { status: 503 }),
          );
        }
        const responses: Record<string, unknown> = {
          '/api/pages': { items: [page], total: 1, nextOffset: null },
          '/api/entities': { items: [entity], total: 1, nextOffset: null },
          '/api/assets': { items: [asset], total: 1, nextOffset: null },
          '/api/records': {
            items: [record],
            filterOptions: { providers: ['notion'], kinds: ['note'] },
            nextOffset: null,
          },
          '/api/pages/launch': page,
          '/api/pages/launch/preview': page,
          '/api/entities/owner': entity,
          '/api/entities/owner/preview': entity,
          '/api/assets/chart': asset,
          '/api/records/research': record,
        };
        if (responses[url.pathname]) {
          return Promise.resolve(Response.json(responses[url.pathname]));
        }
        throw new Error(`Unexpected API request ${url.pathname}`);
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  const router = createRouter({
    routeTree,
    context: { queryClient: client },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return {
    router,
    failRecord: (failed: boolean) => {
      failedResource = failed;
    },
    dispose: () => {
      cleanup();
      client.clear();
      fetch.mockRestore();
    },
  };
}

test('resource navigation opens unselected collections with their own toolbar and preview', async () => {
  const app = await renderResourceBrowser();
  const user = userEvent.setup();
  try {
    for (const { destination, query, resource, preview, creation, filters } of [
      {
        destination: 'Pages',
        query: 'Search pages',
        resource: 'Launch plan Launch overview',
        preview: 'Knowledge page preview',
        creation: 'New page',
        filters: 'Filter pages',
      },
      {
        destination: 'Entities',
        query: 'Search entities',
        resource: 'Owner You Workspace owner',
        preview: 'Entity preview',
        creation: 'New entity',
        filters: 'Filter entities',
      },
      {
        destination: 'Assets',
        query: 'Search assets',
        resource: 'Launch chart PNG · 1.0 KB',
        preview: 'Asset preview',
        creation: 'New asset',
        filters: undefined,
      },
      {
        destination: 'Records',
        query: 'Search records',
        resource: 'Research notes notion · note',
        preview: 'Record preview',
        creation: undefined,
        filters: 'Filter and sort records',
      },
    ]) {
      await user.click(
        within(screen.getByRole('navigation', { name: 'Workspace' })).getByRole('link', {
          name: destination,
        }),
      );
      expect(await screen.findByRole('searchbox', { name: query })).toBeTruthy();
      expect(screen.queryByRole('complementary', { name: /preview$/ })).toBeNull();
      expect(app.router.state.location.pathname).toBe(`/${destination.toLowerCase()}`);
      if (creation) {
        expect(screen.getByRole('link', { name: creation })).toBeTruthy();
      } else {
        expect(screen.queryByRole('link', { name: /New / })).toBeNull();
      }
      if (filters) {
        expect(screen.getByRole('button', { name: filters })).toBeTruthy();
      } else {
        expect(screen.queryByRole('button', { name: /Filter/ })).toBeNull();
      }
      await user.click(screen.getByRole('link', { name: resource }));
      expect(await screen.findByRole('complementary', { name: preview })).toBeTruthy();
      expect(screen.getByRole('searchbox', { name: query })).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Expand' }));
      expect(await screen.findByRole('region', { name: 'Expanded resource' })).toBeTruthy();
      expect(screen.queryByRole('searchbox')).toBeNull();
      expect(screen.queryByRole('button', { name: /Filter/ })).toBeNull();
      expect(screen.queryByRole('link', { name: /New / })).toBeNull();
    }
  } finally {
    app.dispose();
  }
});

test('related resources preserve the collection, filters and selection across expansion and Back', async () => {
  const app = await renderResourceBrowser('/pages?interval=without');
  const user = userEvent.setup();
  try {
    const listLink = await screen.findByRole('link', { name: 'Launch plan Launch overview' });
    await user.click(listLink);
    await user.click(await screen.findByRole('button', { name: 'Owner' }));
    expect(await screen.findByRole('complementary', { name: 'Entity preview' })).toBeTruthy();
    expect(app.router.state.location.pathname).toBe('/pages');
    expect(app.router.state.location.search).toMatchObject({
      interval: 'without',
      resource: 'entity',
      resourceId: 'owner',
    });
    app.router.history.back();
    expect(
      await screen.findByRole('complementary', { name: 'Knowledge page preview' }),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'chart' }));
    expect(await screen.findByRole('img', { name: 'Launch chart' })).toBeTruthy();
    expect(app.router.state.location.pathname).toBe('/pages');
    app.router.history.back();
    await user.click(await screen.findByRole('button', { name: 'research' }));
    expect(await screen.findByText('Research source content.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    expect(await screen.findByRole('tab', { name: 'Metadata' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back to browsing' }));
    expect(await screen.findByRole('complementary', { name: 'Record preview' })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'Search pages' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close preview' }));
    await waitFor(() => expect(document.activeElement).toBe(listLink));
    expect(app.router.state.location.search.interval).toBe('without');
  } finally {
    app.dispose();
  }
});

test('narrow screens open expanded detail directly and restore browsing on return', async () => {
  const matchMedia = spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: query === '(max-width: 767px)',
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
  }));
  const app = await renderResourceBrowser();
  try {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Launch plan Launch overview' }));
    expect(await screen.findByRole('region', { name: 'Expanded resource' })).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: /preview$/ })).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back to browsing' }));
    expect(await screen.findByRole('searchbox', { name: 'Search pages' })).toBeTruthy();
    expect(app.router.state.location.search.resource).toBeUndefined();
  } finally {
    app.dispose();
    matchMedia.mockRestore();
  }
});

test('preview failures can be retried without leaving the collection', async () => {
  const app = await renderResourceBrowser();
  try {
    const user = userEvent.setup();
    app.failRecord(true);
    await user.click(await screen.findByRole('link', { name: 'Launch plan Launch overview' }));
    await user.click(await screen.findByRole('button', { name: 'research' }));
    expect(await screen.findByText('Record temporarily unavailable')).toBeTruthy();
    app.failRecord(false);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Research source content.')).toBeTruthy();
    expect(app.router.state.location.pathname).toBe('/pages');
  } finally {
    app.dispose();
  }
});

test('direct detail URLs hide collection controls and keep related previews in their collection', async () => {
  const app = await renderResourceBrowser('/pages/launch');
  try {
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Launch plan' })).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Owner' }));
    expect(await screen.findByRole('complementary', { name: 'Entity preview' })).toBeTruthy();
    expect(app.router.state.location.pathname).toBe('/pages');
    expect(screen.getByRole('searchbox', { name: 'Search pages' })).toBeTruthy();
    app.router.history.back();
    expect(await screen.findByRole('heading', { name: 'Launch plan' })).toBeTruthy();
    expect(app.router.state.location.pathname).toBe('/pages/launch');
    expect(screen.queryByRole('searchbox')).toBeNull();
  } finally {
    app.dispose();
  }
});
