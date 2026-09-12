import { expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from '../../src/lib/auth';
import { entitiesQueryOptions, entityPreviewQueryOptions } from '../../src/queries/entities';
import {
  type HypermediaPages,
  hypermediaNeighborhoodsQueryOptions,
} from '../../src/queries/hypermedia';
import { type KnowledgeProfile, profileQueryOptions } from '../../src/queries/profile';
import { sessionQueryOptions } from '../../src/queries/session';
import { routeTree } from '../../src/routeTree.gen';

test('Hypermedia previews entities without filtering pages and recovers from page failures', async () => {
  const timestamp = new Date('2026-01-01T00:00:00.000Z');
  const profile: KnowledgeProfile = {
    selfEntity: {
      readableId: 'owner',
      name: 'Owner',
      description: 'The owner.',
      entityType: null,
      isSelf: true,
      image: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
  const colleague = {
    ...profile.selfEntity,
    readableId: 'colleague',
    name: 'Colleague',
    isSelf: false,
  };
  const session: Session = {
    session: {
      id: 'session',
      token: 'test-token',
      userId: 'owner',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
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
  const response: HypermediaPages = {
    pages: [
      {
        readableId: 'planning',
        title: 'Planning',
        excerpt: 'A planning page.',
        temporalCoverage: null,
        revisionNumber: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        entities: [{ readableId: 'owner' }],
      },
    ],
    nextOffset: null,
    entityReferencesTruncated: false,
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(sessionQueryOptions.queryKey, session);
  client.setQueryData(profileQueryOptions.queryKey, profile);
  client.setQueryData(entitiesQueryOptions().queryKey, {
    pages: [{ items: [profile.selfEntity, colleague], total: 2, nextOffset: null }],
    pageParams: [0],
  });
  for (const entity of [profile.selfEntity, colleague]) {
    client.setQueryData(hypermediaNeighborhoodsQueryOptions([{ anchor: entity }]).queryKey, {
      entities: [entity],
      neighborhoods: [{ anchor: { readableId: entity.readableId }, available: true, neighbors: [], nextCursor: null }],
      relationships: [],
      relationshipsTruncated: false,
    });
    client.setQueryData(entityPreviewQueryOptions(entity.readableId).queryKey, {
      ...entity,
      pages: [],
    });
  }
  const requests: URL[] = [];
  let unavailable = true;
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (input: Parameters<typeof globalThis.fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : input);
        requests.push(url);
        expect(url.searchParams.has('query')).toBe(false);
        expect(url.searchParams.has('entities')).toBe(false);
        if (url.pathname !== '/api/hypermedia/pages') {
          throw new Error(`Unexpected request: ${url.pathname}`);
        }
        return Promise.resolve(
          unavailable
            ? Response.json({ error: 'Pages unavailable' }, { status: 503 })
            : Response.json(response),
        );
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  try {
    const router = createRouter({
      routeTree,
      context: { queryClient: client },
      history: createMemoryHistory({
        initialEntries: ['/hypermedia?month=2026-01'],
      }),
    });
    await router.load();
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Open sidebar' }));
    expect(screen.getByRole('link', { name: 'Pages' })).toBeTruthy();
    expect(screen.queryByText('1 entity selected')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear selected entities' })).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t load pages.');
    unavailable = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Open knowledge page Planning' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    const user = userEvent.setup();
    const pageRequestCount = requests.length;
    for (const name of ['Owner', 'Colleague', 'Colleague']) {
      await user.click(screen.getByRole('link', { name: `Open entity ${name}` }));
      expect(await screen.findByRole('heading', { name })).toBeTruthy();
      expect(screen.getAllByRole('complementary', { name: 'Entity preview' })).toHaveLength(1);
      expect(screen.getByRole('link', { name: 'Open knowledge page Planning' })).toBeTruthy();
      expect(router.state.location.search).toEqual({
        month: '2026-01',
        resource: 'entity',
        resourceId: name.toLowerCase(),
      });
    }
    await user.click(screen.getByRole('complementary', { name: 'Entity preview' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Entity preview' })).toBeNull();
    expect(router.state.location.search).toEqual({ month: '2026-01' });
    await user.click(screen.getByRole('link', { name: 'Open entity Owner' }));
    await user.click(await screen.findByRole('button', { name: 'Close preview' }));
    expect(screen.queryByRole('complementary', { name: 'Entity preview' })).toBeNull();
    expect(router.state.location.search).toEqual({ month: '2026-01' });
    expect(requests).toHaveLength(pageRequestCount);
    expect(requests.every((url) => url.searchParams.get('time') === '2026-01')).toBe(true);
  } finally {
    cleanup();
    client.clear();
    fetch.mockRestore();
  }
});
