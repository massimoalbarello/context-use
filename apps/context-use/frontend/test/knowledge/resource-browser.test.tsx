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
import type { ContextRecord } from '../../src/queries/records';
import { sessionQueryOptions } from '../../src/queries/session';
import { routeTree } from '../../src/routeTree.gen';
import { mockViewport } from '../support/viewport';

afterEach(cleanup);

function requestUrl(input: Parameters<typeof globalThis.fetch>[0]) {
  return new URL(input instanceof Request ? input.url : input);
}

function collectionResponse({ url, item }: { url: URL; item: unknown }) {
  const items = url.searchParams.get('visibility') === 'public' ? [] : [item];
  return { items, total: items.length, nextOffset: null };
}

async function renderResourceBrowser({
  path = '/app/pages',
  unpublishedPage = false,
  entityPagesResponse,
  publicationResponse = (url) =>
    Response.json({
      resourceType: url.pathname.split('/')[3],
      publicId: null,
      publishedAt: null,
      publishedRevisionNumber: null,
    }),
}: {
  path?: string;
  unpublishedPage?: boolean;
  publicationResponse?: (url: URL) => Response | Promise<Response>;
  entityPagesResponse?: (input: { url: URL; page: KnowledgePage }) => Response;
} = {}) {
  const timestamp = new Date('2026-01-01T00:00:00Z');
  const entity: EntityDetail = {
    publishedAt: null,
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
    publishedAt: null,
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
  const record: ContextRecord = {
    publishedAt: null,
    readableId: 'research',
    title: 'Research notes',
    sourceCreatedAt: null,
    sourceUpdatedAt: null,
    sourceOccurredAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    body: 'Research source content.',
    backlinks: [],
    source: { provider: 'notion', kind: 'note', id: 'source-record', url: null },
  };
  const page: KnowledgePage = {
    publishedAt: unpublishedPage ? timestamp.toISOString() : null,
    publishedRevisionNumber: unpublishedPage ? 1 : null,
    readableId: 'launch',
    title: 'Launch plan',
    excerpt: 'Launch overview',
    temporalCoverage: null,
    revisionNumber: unpublishedPage ? 2 : 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    markdown:
      '# Launch plan\n\n[Owner](context-use://entity/owner) uses [chart](context-use://asset/chart) and [research](context-use://record/research). See the [timeline](context-use://page/launch#timeline).\n\n## Timeline\n\n[Milestones](context-use://page/milestones#delivery)\n\n![Chart](context-use://asset/chart)',
    mentions: [entity],
    recordReferences: [
      {
        readableId: record.readableId,
        title: record.title,
        provider: record.source.provider,
        kind: record.source.kind,
        available: true,
      },
    ],
    references: [],
    backlinks: [],
    assetUsages: [],
    revisions: [],
  };
  entity.pages = [
    {
      publishedAt: null,
      publishedRevisionNumber: null,
      readableId: page.readableId,
      title: page.title,
      excerpt: page.excerpt,
      temporalCoverage: page.temporalCoverage,
      revisionNumber: page.revisionNumber,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
    },
  ];
  asset.usages = [{ kind: 'page', page: entity.pages[0]!, presentation: 'embed' }];
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
  const requests: URL[] = [];
  let failedResource = false;
  let pendingMilestones: Promise<void> | undefined;
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (input: Parameters<typeof globalThis.fetch>[0]) => {
        const url = requestUrl(input);
        requests.push(url);
        if (url.pathname.startsWith('/api/publications/')) {
          return Promise.resolve(publicationResponse(url));
        }
        if (url.pathname === '/api/pages' && url.searchParams.has('entityReadableId')) {
          return Promise.resolve(
            entityPagesResponse?.({ url, page }) ??
              Response.json(collectionResponse({ url, item: page })),
          );
        }
        if (
          url.pathname === '/api/pages/milestones' ||
          url.pathname === '/api/pages/milestones/preview'
        ) {
          return (pendingMilestones ?? Promise.resolve()).then(() =>
            Response.json({
              ...page,
              readableId: 'milestones',
              title: 'Milestones',
              markdown: '# Milestones\n\n## Delivery\n\nLaunch delivery details.',
            }),
          );
        }
        if (url.pathname === '/api/records/research' && failedResource) {
          return Promise.resolve(
            Response.json({ error: 'Record temporarily unavailable' }, { status: 503 }),
          );
        }
        const responses: Record<string, unknown> = {
          '/api/map/neighborhoods': {
            entities: [entity],
            neighborhoods: [
              {
                anchor: { readableId: entity.readableId },
                available: true,
                neighbors: [],
                nextCursor: null,
              },
            ],
            relationships: [],
            relationshipsTruncated: false,
          },
          '/api/map/pages': {
            pages: [],
            nextOffset: null,
            entityReferencesTruncated: false,
          },
          '/api/hypermedia/search': { results: [], totalMatches: 0 },
          '/api/pages': collectionResponse({ url, item: page }),
          '/api/entities': collectionResponse({ url, item: entity }),
          '/api/assets': collectionResponse({ url, item: asset }),
          '/api/records': {
            items: [record],
            filterOptions: { providers: ['notion'], kinds: ['note'] },
            nextOffset: null,
          },
          '/api/pages/launch': page,
          '/api/pages/launch/preview': page,
          '/api/entities/owner': entity,
          '/api/entities/owner/preview': {
            name: entity.name,
            description: entity.description,
            image: entity.image,
          },
          '/api/assets/chart': asset,
          '/api/assets/chart/preview': {
            readableId: asset.readableId,
            name: asset.name,
            mediaType: asset.mediaType,
            extension: asset.extension,
            sizeBytes: asset.sizeBytes,
          },
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
    defaultPreload: 'intent',
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
    requests,
    deferMilestones: () => {
      const pending = Promise.withResolvers<void>();
      pendingMilestones = pending.promise;
      return pending.resolve;
    },
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
    await user.click(screen.getByRole('button', { name: 'Open sidebar' }));
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
        filters: 'Filter assets',
      },
      {
        destination: 'Records',
        query: 'Search records',
        resource: 'Research notes notion · note',
        preview: 'Record preview',
        creation: undefined,
        filters: 'Filter records',
      },
    ]) {
      await user.click(
        within(screen.getByRole('navigation', { name: 'Workspace' })).getByRole('link', {
          name: destination,
        }),
      );
      expect(await screen.findByRole('searchbox', { name: query })).toBeTruthy();
      expect(screen.queryByRole('complementary', { name: /preview$/ })).toBeNull();
      expect(app.router.state.location.pathname).toBe(`/app/${destination.toLowerCase()}`);
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

test('side previews preserve the collection and filters while navigating related resources', async () => {
  const app = await renderResourceBrowser({ path: '/app/pages?interval=without' });
  const user = userEvent.setup();
  try {
    const listLink = await screen.findByRole('link', { name: 'Launch plan Launch overview' });
    await user.click(listLink);
    await user.click(await screen.findByRole('link', { name: 'Owner' }));
    expect(await screen.findByRole('complementary', { name: 'Entity preview' })).toBeTruthy();
    expect(app.router.state.location.pathname).toBe('/app/pages');
    expect(app.router.state.location.search).toMatchObject({
      interval: 'without',
      resource: 'entity',
      resourceId: 'owner',
    });
    app.router.history.back();
    expect(
      await screen.findByRole('complementary', { name: 'Knowledge page preview' }),
    ).toBeTruthy();
    await user.click(screen.getByRole('link', { name: 'chart' }));
    expect(await screen.findByRole('img', { name: 'Launch chart' })).toBeTruthy();
    expect(app.router.state.location.pathname).toBe('/app/pages');
    app.router.history.back();
    await user.click(await screen.findByRole('link', { name: 'research' }));
    expect(await screen.findByText('Research source content.')).toBeTruthy();
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
    await user.click(await screen.findByRole('link', { name: 'Owner' }));
    expect(await screen.findByRole('heading', { name: 'Owner' })).toBeTruthy();
    expect(app.router.state.location.search.expanded).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Back to browsing' }));
    expect(await screen.findByRole('searchbox', { name: 'Search pages' })).toBeTruthy();
    expect(app.router.state.location.pathname).toBe('/app/pages');
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
    await user.click(await screen.findByRole('link', { name: 'research' }));
    expect(await screen.findByText('Record temporarily unavailable')).toBeTruthy();
    app.failRecord(false);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Research source content.')).toBeTruthy();
    expect(app.router.state.location.pathname).toBe('/app/pages');
  } finally {
    app.dispose();
  }
});

test('direct detail URLs keep related resources expanded and support browser Back', async () => {
  const app = await renderResourceBrowser({ path: '/app/pages/launch' });
  try {
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Launch plan' })).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Owner' }));
    expect(await screen.findByRole('region', { name: 'Expanded resource' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Owner' })).toBeTruthy();
    expect(app.router.state.location.pathname).toBe('/app/pages');
    expect(screen.queryByRole('searchbox')).toBeNull();
    app.router.history.back();
    expect(await screen.findByRole('heading', { name: 'Launch plan' })).toBeTruthy();
    expect(app.router.state.location.pathname).toBe('/app/pages/launch');
    expect(screen.queryByRole('searchbox')).toBeNull();
  } finally {
    app.dispose();
  }
});

test('preview links retain canonical URLs and modifier clicks without leaving the collection', async () => {
  const viewport = mockViewport();
  const app = await renderResourceBrowser({ path: '/app/pages?resource=page&resourceId=launch' });
  const user = userEvent.setup();
  try {
    const preview = await screen.findByRole('complementary', { name: 'Knowledge page preview' });
    for (const [name, path] of [
      ['Owner', '/app/entities/owner'],
      ['chart', '/app/assets/chart'],
      ['research', '/app/records/research'],
      ['timeline', '/app/pages/launch'],
    ] as const) {
      const link = await within(preview).findByRole('link', { name });
      expect(link.getAttribute('href')).toStartWith(path);
      await user.keyboard('{Control>}');
      await user.click(link);
      await user.keyboard('{/Control}');
      expect(app.router.state.location.pathname).toBe('/app/pages');
      expect(app.router.state.location.search.resourceId).toBe('launch');
    }
    expect(within(preview).getByRole('img', { name: 'Chart' }).getAttribute('src')).toBe(
      '/api/assets/chart/content',
    );
    await user.click(within(preview).getByRole('link', { name: 'timeline' }));
    expect(app.router.state.location.hash).toBe('timeline');
    expect(app.router.state.location.search.resourceId).toBe('launch');
  } finally {
    app.dispose();
    viewport.restore();
  }
});

for (const { kind, id, name, edit, relationships } of [
  {
    kind: 'asset',
    id: 'chart',
    name: 'Launch chart',
    edit: 'Edit asset',
    relationships: 'Embedded in',
  },
  {
    kind: 'entity',
    id: 'owner',
    name: 'Owner',
    edit: 'Edit entity',
    relationships: 'Mentioned by',
  },
]) {
  test(`${kind} previews load identity independently and Expand loads full detail`, async () => {
    const app = await renderResourceBrowser({
      path: `/app/${kind === 'asset' ? 'assets' : 'entities'}?resource=${kind}&resourceId=${id}`,
    });
    try {
      const user = userEvent.setup();
      await screen.findByRole('heading', { name });
      const preview = screen.getByRole('complementary', {
        name: `${kind === 'asset' ? 'Asset' : 'Entity'} preview`,
      });
      expect(within(preview).queryByText(relationships)).toBeNull();
      const path = `/api/${kind === 'asset' ? 'assets' : 'entities'}/${id}`;
      expect(
        app.requests
          .filter((url) => url.pathname === path || url.pathname === `${path}/preview`)
          .map((url) => url.pathname + url.search),
      ).toEqual([`${path}/preview`]);
      await user.click(screen.getByRole('button', { name: 'Expand' }));
      await screen.findByRole('button', { name: edit });
      expect(screen.getByText(relationships)).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Launch plan Launch overview' })).toBeTruthy();
      expect(
        app.requests
          .filter((url) => url.pathname === path || url.pathname === `${path}/preview`)
          .map((url) => url.pathname + url.search),
      ).toEqual([`${path}/preview`, path]);
    } finally {
      app.dispose();
    }
  });
}

test('searching and clearing an asset query preserves its preview', async () => {
  const app = await renderResourceBrowser({ path: '/app/assets?resource=asset&resourceId=chart' });
  try {
    const user = userEvent.setup();
    const input = await screen.findByRole('searchbox', { name: 'Search assets' });
    await user.type(input, 'launch{Enter}');
    await waitFor(() => expect(app.router.state.location.search.q).toBe('launch'));
    expect(screen.getByRole('complementary', { name: 'Asset preview' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(app.router.state.location.search.q).toBeUndefined());
    expect(app.router.state.location.search.resourceId).toBe('chart');
  } finally {
    app.dispose();
  }
});

for (const { path, filter, reset, key } of [
  {
    path: '/app/entities?entityType=person&visibility=private&resource=page&resourceId=launch',
    filter: 'Filter entities',
    reset: 'Reset filters',
    key: 'entityType',
  },
  {
    path: '/app/records?provider=notion&resource=page&resourceId=launch',
    filter: 'Filter records',
    reset: 'Reset filters',
    key: 'provider',
  },
] as const) {
  test(`${filter} resets only collection criteria and keeps the selected preview`, async () => {
    const app = await renderResourceBrowser({ path: path });
    try {
      const user = userEvent.setup();
      await screen.findByRole('heading', { name: 'Launch plan' });
      await user.click(screen.getByRole('button', { name: filter }));
      await user.click(screen.getByRole('button', { name: reset }));
      await waitFor(() => expect(app.router.state.location.search[key]).toBeUndefined());
      if (key === 'entityType') {
        expect(app.router.state.location.search.visibility).toBeUndefined();
      }
      expect(app.router.state.location.search.resourceId).toBe('launch');
    } finally {
      app.dispose();
    }
  });
}

test('page interval and date filters keep the selected resource', async () => {
  const app = await renderResourceBrowser({
    path: '/app/pages?from=2026-01-01&to=2026-01-31&resource=page&resourceId=launch',
  });
  try {
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Launch plan' });
    await user.click(screen.getByRole('button', { name: 'Filter pages' }));
    await user.click(
      screen.getByRole('button', { name: 'Filter by date range: 01/01/2026 – 31/01/2026' }),
    );
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(app.router.state.location.search.from).toBeUndefined());
    expect(app.router.state.location.search.resourceId).toBe('launch');
    await user.click(screen.getByRole('tab', { name: 'Without' }));
    await waitFor(() => expect(app.router.state.location.search.interval).toBe('without'));
    expect(app.router.state.location.search.resourceId).toBe('launch');
  } finally {
    app.dispose();
  }
});

for (const { link, kind, id } of [
  { link: 'Owner', kind: 'entity', id: 'owner' },
  { link: 'chart', kind: 'asset', id: 'chart' },
  { link: 'research', kind: 'record', id: 'research' },
  { link: 'timeline', kind: 'page', id: 'launch' },
]) {
  test(`expanded ${kind} links retain focus and return to the original collection`, async () => {
    const app = await renderResourceBrowser({
      path: '/app/pages?interval=without&resource=page&resourceId=launch&expanded=true',
    });
    try {
      const user = userEvent.setup();
      await user.click(await screen.findByRole('link', { name: link }));
      expect(app.router.state.location.pathname).toBe('/app/pages');
      expect(app.router.state.location.search).toMatchObject({
        resource: kind,
        resourceId: id,
        expanded: true,
      });
      const expanded = screen.getByRole('region', { name: 'Expanded resource' });
      if (kind !== 'page') {
        expect(document.activeElement).toBe(expanded);
      }
      expect(screen.queryByRole('complementary', { name: /preview$/ })).toBeNull();
      expect(screen.queryByRole('searchbox')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Back to browsing' }));
      await waitFor(() => expect(app.router.state.location.search.expanded).toBeUndefined());
      expect(app.router.state.location.pathname).toBe('/app/pages');
      expect(await screen.findByRole('searchbox')).toBeTruthy();
      expect(screen.getByRole('complementary', { name: /preview$/ })).toBeTruthy();
      expect(app.router.state.location.search).toMatchObject({ resource: kind, resourceId: id });
      expect(app.router.state.location.search.expanded).toBeUndefined();
      expect(app.router.state.location.search.interval).toBe('without');
      app.router.history.back();
      await waitFor(() => expect(app.router.state.location.search.expanded).toBe(true));
      expect(app.router.state.location.pathname).toBe('/app/pages');
      expect(screen.queryByRole('searchbox')).toBeNull();
    } finally {
      app.dispose();
    }
  });
}

test('expanded navigation from Map returns to Map with its original month', async () => {
  const app = await renderResourceBrowser({
    path: '/app/map?month=2007-08&resource=page&resourceId=launch&expanded=true',
  });
  try {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Owner' }));
    expect(await screen.findByRole('heading', { name: 'Owner' })).toBeTruthy();
    expect(app.router.state.location.pathname).toBe('/app/map');
    expect(app.router.state.location.search.expanded).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Back to browsing' }));
    expect(await screen.findByRole('complementary', { name: 'Entity preview' })).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(app.router.state.location.pathname).toBe('/app/map');
    expect(app.router.state.location.search.month).toBe('2007-08');
    expect(app.router.state.location.search.resourceId).toBe('owner');
  } finally {
    app.dispose();
  }
});

for (const expanded of [false, true]) {
  test(`section links reveal asynchronously loaded content in ${expanded ? 'expanded detail' : 'preview'}`, async () => {
    const app = await renderResourceBrowser({
      path: `/app/pages?resource=page&resourceId=launch${expanded ? '&expanded=true' : ''}`,
    });
    const revealed: HTMLElement[] = [];
    const scroll = spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (
      this: HTMLElement,
    ) {
      revealed.push(this);
    });
    try {
      const release = app.deferMilestones();
      const user = userEvent.setup();
      await user.click(await screen.findByRole('link', { name: 'Milestones' }));
      expect(app.router.state.location.hash).toBe('delivery');
      expect(screen.queryByRole('heading', { name: 'Delivery' })).toBeNull();
      release();
      const section = await screen.findByRole('heading', { name: 'Delivery' });
      await waitFor(() => expect(revealed).toContain(section));
    } finally {
      scroll.mockRestore();
      app.dispose();
    }
  });
}

for (const collection of ['pages', 'entities', 'assets'] as const) {
  test(`${collection} visibility changes preserve selection, search, and browsing history`, async () => {
    const app = await renderResourceBrowser({
      path: `/app/${collection}?visibility=private&resource=page&resourceId=launch`,
    });
    try {
      const user = userEvent.setup();
      await screen.findByRole('heading', { name: 'Launch plan' });
      expect(screen.queryByRole('tablist', { name: 'Visibility' })).toBeNull();
      await user.click(screen.getByRole('button', { name: `Filter ${collection}` }));
      const group = screen.getByRole('tablist', { name: 'Visibility' });
      expect(within(group).getByRole('tab', { name: 'Private', selected: true })).toBeTruthy();
      await user.click(within(group).getByRole('tab', { name: 'Public' }));
      await waitFor(() => expect(app.router.state.location.search.visibility).toBe('public'));
      expect(app.router.state.location.search.resourceId).toBe('launch');
      expect(await screen.findByText(`No ${collection} match these filters.`)).toBeTruthy();
      expect(
        app.requests.some(
          (url) =>
            url.pathname === `/api/${collection}` &&
            url.searchParams.get('visibility') === 'public',
        ),
      ).toBe(true);
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('tablist', { name: 'Visibility' })).toBeNull();
      await user.type(screen.getByRole('searchbox'), 'launch{Enter}');
      await waitFor(() => expect(app.router.state.location.search.q).toBe('launch'));
      expect(
        app.requests.some(
          (url) =>
            url.pathname === '/api/hypermedia/search' &&
            url.searchParams.get('visibility') === 'public',
        ),
      ).toBe(true);
      await user.click(screen.getByRole('button', { name: 'Expand' }));
      expect(await screen.findByRole('region', { name: 'Expanded resource' })).toBeTruthy();
      expect(screen.queryByRole('tablist', { name: 'Visibility' })).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Back to browsing' }));
      await user.click(await screen.findByRole('button', { name: `Filter ${collection}` }));
      expect(await screen.findByRole('tab', { name: 'Public', selected: true })).toBeTruthy();
      await user.keyboard('{Escape}');
      expect(app.router.state.location.search).toMatchObject({
        q: 'launch',
        visibility: 'public',
        resourceId: 'launch',
      });
      app.router.history.back();
      expect(await screen.findByRole('region', { name: 'Expanded resource' })).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Back to browsing' }));
      await user.click(await screen.findByRole('button', { name: `Filter ${collection}` }));
      await user.click(
        within(screen.getByRole('tablist', { name: 'Visibility' })).getByRole('tab', {
          name: 'All',
        }),
      );
      await waitFor(() => expect(app.router.state.location.search.visibility).toBeUndefined());
      expect(app.router.state.location.search).toMatchObject({ q: 'launch', resourceId: 'launch' });
      expect(app.router.state.location.href).not.toContain('visibility');
      await user.keyboard('{Escape}');
      await user.click(
        within(screen.getByRole('navigation', { name: 'Workspace' })).getByRole('link', {
          name: 'Records',
        }),
      );
      expect(await screen.findByRole('searchbox', { name: 'Search records' })).toBeTruthy();
      expect(screen.queryByRole('tablist', { name: 'Visibility' })).toBeNull();
      expect(app.router.state.location.search.visibility).toBeUndefined();
    } finally {
      app.dispose();
    }
  });
}

test('entity preview paginates mentioning pages, retries without losing rows, and keeps collection navigation', async () => {
  let failNextPage = true;
  const app = await renderResourceBrowser({
    path: '/app/entities?resource=entity&resourceId=owner',
    entityPagesResponse: ({ url, page }) => {
      const isNextPage = url.searchParams.get('offset') === '1';
      if (isNextPage && failNextPage) {
        failNextPage = false;
        return Response.json({ error: 'Next page unavailable' }, { status: 503 });
      }
      return Response.json({
        items: [isNextPage ? { ...page, readableId: 'milestones', title: 'Milestones' } : page],
        total: 2,
        nextOffset: isNextPage ? null : 1,
      });
    },
  });
  const user = userEvent.setup();
  try {
    const preview = await screen.findByRole('complementary', { name: 'Entity preview' });
    const mentions = within(preview).getByRole('region', { name: 'Mentioned in' });
    await within(mentions).findByRole('link', { name: 'Launch plan Launch overview' });
    expect(app.requests.some((url) => url.searchParams.get('entityReadableId') === 'owner')).toBe(
      true,
    );
    await user.click(within(mentions).getByRole('button', { name: 'Load more' }));
    await within(mentions).findByText('Couldn’t load more.');
    expect(within(mentions).getAllByRole('link')).toHaveLength(1);
    await user.click(within(mentions).getByRole('button', { name: 'Retry' }));
    const nextPage = await within(mentions).findByRole('link', {
      name: 'Milestones Launch overview',
    });
    expect(within(mentions).getAllByRole('link')).toHaveLength(2);
    expect(within(mentions).queryByRole('button', { name: 'Load more' })).toBeNull();
    await user.click(nextPage);
    await screen.findByRole('complementary', { name: 'Knowledge page preview' });
    expect(app.router.state.location.pathname).toBe('/app/entities');
    expect(app.router.state.location.search).toMatchObject({
      resource: 'page',
      resourceId: 'milestones',
    });
  } finally {
    app.dispose();
  }
});

test('entity preview keeps its identity visible when mentioning pages fail and can recover', async () => {
  let unavailable = true;
  const app = await renderResourceBrowser({
    path: '/app/entities?resource=entity&resourceId=owner',
    entityPagesResponse: ({ url, page }) =>
      unavailable
        ? Response.json({ error: 'Pages temporarily unavailable' }, { status: 503 })
        : Response.json(collectionResponse({ url, item: page })),
  });
  const user = userEvent.setup();
  try {
    const preview = await screen.findByRole('complementary', { name: 'Entity preview' });
    await within(preview).findByText('Pages temporarily unavailable');
    expect(within(preview).getByRole('heading', { name: 'Owner' })).toBeTruthy();
    unavailable = false;
    await user.click(within(preview).getByRole('button', { name: 'Try again' }));
    await within(preview).findByRole('link', { name: 'Launch plan Launch overview' });
  } finally {
    app.dispose();
  }
});

test('entity preview explains when no pages mention it', async () => {
  const app = await renderResourceBrowser({
    path: '/app/entities?resource=entity&resourceId=owner',
    entityPagesResponse: () => Response.json({ items: [], total: 0, nextOffset: null }),
  });
  try {
    const preview = await screen.findByRole('complementary', { name: 'Entity preview' });
    await within(preview).findByText('No pages mention this entity yet.');
    expect(within(preview).queryByRole('button', { name: 'Load more' })).toBeNull();
  } finally {
    app.dispose();
  }
});

for (const [kind, id, label] of [
  ['page', 'launch', 'Knowledge page'],
  ['entity', 'owner', 'Entity'],
  ['asset', 'chart', 'Asset'],
  ['record', 'research', 'Record'],
] as const) {
  for (const published of [false, true]) {
    test(`${kind} preview shows its ${published ? 'Public' : 'Private'} status`, async () => {
      const app = await renderResourceBrowser({
        path: `/app/pages?resource=${kind}&resourceId=${id}`,
        publicationResponse: (url) => {
          expect(url.pathname).toBe(`/api/publications/${kind}/${id}`);
          return Response.json({
            resourceType: kind,
            publicId: published ? 'public_handle' : null,
            publishedAt: published ? '2026-01-01T00:00:00Z' : null,
            publishedRevisionNumber: published ? 1 : null,
          });
        },
      });
      try {
        const preview = await screen.findByRole('complementary', { name: `${label} preview` });
        expect(await within(preview).findByText(published ? 'Public' : 'Private')).toBeTruthy();
        expect(within(preview).queryByText(published ? 'Private' : 'Public')).toBeNull();
      } finally {
        app.dispose();
      }
    });
  }
}

test('switching previews does not reuse visibility while status loads or fails, and retry recovers', async () => {
  const pending = Promise.withResolvers<Response>();
  let entityResponse = pending.promise;
  const app = await renderResourceBrowser({
    path: '/app/pages?resource=page&resourceId=launch',
    publicationResponse: (url) =>
      url.pathname === '/api/publications/entity/owner'
        ? entityResponse
        : Response.json({
            resourceType: 'page',
            publicId: 'public_page',
            publishedAt: '2026-01-01T00:00:00Z',
            publishedRevisionNumber: 1,
          }),
  });
  try {
    const user = userEvent.setup();
    const page = await screen.findByRole('complementary', { name: 'Knowledge page preview' });
    await within(page).findByText('Public');
    await user.click(await within(page).findByRole('link', { name: 'Owner' }));
    const entity = await screen.findByRole('complementary', { name: 'Entity preview' });
    await within(entity).findByText('Loading publication status…');
    expect(within(entity).queryByText('Public')).toBeNull();
    expect(within(entity).queryByText('Private')).toBeNull();

    pending.resolve(Response.json({ error: 'Status unavailable' }, { status: 503 }));
    const retry = await within(entity).findByRole('button', { name: 'Retry publication status' });
    expect(within(entity).queryByText('Public')).toBeNull();
    expect(within(entity).queryByText('Private')).toBeNull();

    entityResponse = Promise.resolve(
      Response.json({ resourceType: 'entity', publicId: null, publishedAt: null }),
    );
    await user.click(retry);
    expect(await within(entity).findByText('Private')).toBeTruthy();
  } finally {
    app.dispose();
  }
});

test('unpublished revision tag opens revisions from the collection and restores browsing', async () => {
  const user = userEvent.setup();
  const app = await renderResourceBrowser({ unpublishedPage: true });
  try {
    const tag = await screen.findByRole('link', { name: 'Unpublished revisions' });
    expect(tag.getAttribute('href')).toBe('/app/pages/launch?view=revisions');
    expect(screen.queryByText('Public')).toBeNull();
    await user.click(tag);
    await waitFor(() =>
      expect(app.router.state.location.search).toMatchObject({
        resource: 'page',
        resourceId: 'launch',
        expanded: true,
        view: 'revisions',
      }),
    );
    expect(app.router.state.location.pathname).toBe('/app/pages');
    expect(await screen.findByRole('tab', { name: 'Revisions', selected: true })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back to browsing' }));
    expect(await screen.findByRole('link', { name: 'Unpublished revisions' })).toBeTruthy();
    await user.click(screen.getByRole('link', { name: 'Launch plan Launch overview' }));
    expect(
      await screen.findByRole('complementary', { name: 'Knowledge page preview' }),
    ).toBeTruthy();
    expect(app.router.state.location.search.view).toBeUndefined();
  } finally {
    app.dispose();
  }
});
