import { expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from '../../src/lib/auth';
import { entitiesQueryOptions } from '../../src/queries/entities';
import {
  type HypermediaPages,
  hypermediaEntityNeighborhoodQueryOptions,
} from '../../src/queries/hypermedia';
import { type KnowledgeProfile, profileQueryOptions } from '../../src/queries/profile';
import { sessionQueryOptions } from '../../src/queries/session';
import { routeTree } from '../../src/routeTree.gen';

test('Hypermedia ignores keyword URL state and recovers from page failures without search', async () => {
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
    pages: [{ items: [profile.selfEntity], total: 1, nextOffset: null }],
    pageParams: [0],
  });
  client.setQueryData(
    hypermediaEntityNeighborhoodQueryOptions({
      anchor: { readableId: 'owner' },
    }).queryKey,
    { anchor: profile.selfEntity, neighbors: [], nextCursor: null },
  );
  let unavailable = true;
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (input: Parameters<typeof globalThis.fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : input);
        expect(url.searchParams.has('query')).toBe(false);
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
      history: createMemoryHistory({ initialEntries: ['/hypermedia?q=nonexistent-keyword'] }),
    });
    await router.load();
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('link', { name: 'Browse resources' })).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
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
