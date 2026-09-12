import { expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from '../../src/lib/auth';
import { entitiesQueryOptions } from '../../src/queries/entities';
import {
  type HypermediaPages,
  hypermediaResourceNeighborhoodQueryOptions,
} from '../../src/queries/hypermedia';
import { type KnowledgeProfile, profileQueryOptions } from '../../src/queries/profile';
import { sessionQueryOptions } from '../../src/queries/session';
import { routeTree } from '../../src/routeTree.gen';

function mapFixture() {
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
        resources: [{ kind: 'entity', readableId: 'owner' }],
      },
    ],
    matchedResources: null,
    nextOffset: null,
    resourceReferencesTruncated: false,
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(sessionQueryOptions.queryKey, session);
  client.setQueryData(profileQueryOptions.queryKey, profile);
  client.setQueryData(entitiesQueryOptions().queryKey, {
    pages: [{ items: [profile.selfEntity], total: 1, nextOffset: null }],
    pageParams: [0],
  });
  client.setQueryData(
    hypermediaResourceNeighborhoodQueryOptions({
      anchor: { kind: 'entity', readableId: 'owner' },
    }).queryKey,
    { anchor: { kind: 'entity', entity: profile.selfEntity }, neighbors: [], nextCursor: null },
  );
  return { client, profile, response };
}

test('map page failures stay inside the canvas and can be retried', async () => {
  const { client, response } = mapFixture();
  let unavailable = true;
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (input: Parameters<typeof globalThis.fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : input);
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
      history: createMemoryHistory({ initialEntries: ['/hypermedia'] }),
    });
    await router.load();
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('searchbox', { name: 'Keyword' })).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t load pages.');
    unavailable = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Open knowledge page Planning' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  } finally {
    cleanup();
    client.clear();
    fetch.mockRestore();
  }
});

test('zooming out loads disconnected entities and every page batch without a viewport filter', async () => {
  const { client, profile, response } = mapFixture();
  const laterEntities = ['disconnected', 'remote'].map((readableId) => ({
    ...profile.selfEntity,
    readableId,
    name: readableId,
    isSelf: false,
  }));
  client.setQueryData(entitiesQueryOptions().queryKey, {
    pages: [{ items: [profile.selfEntity], total: 3, nextOffset: 1 }],
    pageParams: [0],
  });
  const pageOffsets: number[] = [];
  const batchSize = 32;
  const lastOffset = batchSize * 2;
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (input: Parameters<typeof globalThis.fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : input);
        if (url.pathname === '/api/entities') {
          return Promise.resolve(
            Response.json({ items: laterEntities, total: 3, nextOffset: null }),
          );
        }
        if (url.pathname === '/api/hypermedia/resources') {
          const entity = laterEntities.find(
            ({ readableId }) => url.searchParams.get('anchor') === `entity:${readableId}`,
          )!;
          return Promise.resolve(
            Response.json({ anchor: { kind: 'entity', entity }, neighbors: [], nextCursor: null }),
          );
        }
        if (url.pathname !== '/api/hypermedia/pages') {
          throw new Error(`Unexpected request: ${url.pathname}`);
        }
        expect(url.searchParams.has('visible')).toBe(false);
        expect(url.searchParams.has('resources')).toBe(false);
        expect(url.searchParams.has('kinds')).toBe(false);
        const offset = Number(url.searchParams.get('offset'));
        pageOffsets.push(offset);
        return Promise.resolve(
          Response.json({
            ...response,
            pages: [
              {
                ...response.pages[0],
                readableId: `unlinked-${offset}`,
                title: `Unlinked ${offset}`,
                resources: [],
              },
            ],
            nextOffset: offset < lastOffset ? offset + batchSize : null,
          }),
        );
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  try {
    const router = createRouter({
      routeTree,
      context: { queryClient: client },
      history: createMemoryHistory({ initialEntries: ['/hypermedia'] }),
    });
    await router.load();
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole('link', { name: 'Open knowledge page Unlinked 0' }),
    ).toBeTruthy();
    const canvas = screen.getByLabelText('Interactive Hypermedia');
    const viewportWidth = 900;
    const viewportHeight = 620;
    const rect = spyOn(canvas, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, viewportWidth, viewportHeight),
    );
    const zoomSteps = 6;
    // biome-ignore lint/nursery/useAwaitThenable: React act intentionally returns a thenable.
    await act(() => {
      for (let step = 0; step < zoomSteps; step += 1) {
        const pinch = new WheelEvent('wheel', {
          cancelable: true,
          deltaY: 80,
          clientX: viewportWidth / 2,
          clientY: viewportHeight / 2,
        });
        Object.defineProperties(pinch, {
          ctrlKey: { value: true },
          clientX: { value: viewportWidth / 2 },
          clientY: { value: viewportHeight / 2 },
        });
        fireEvent(canvas, pinch);
      }
    });
    rect.mockRestore();
    expect(
      await screen.findByRole('link', { name: 'Open knowledge page Unlinked 64' }),
    ).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'Open entity disconnected' })).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'Open entity remote' })).toBeTruthy();
    expect(pageOffsets).toEqual([0, batchSize, lastOffset]);
    expect(screen.queryByRole('link', { name: /^Open asset/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Load more pages' })).toBeNull();
  } finally {
    cleanup();
    client.clear();
    fetch.mockRestore();
  }
});
