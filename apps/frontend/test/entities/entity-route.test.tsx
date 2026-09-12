import { expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from '../../src/lib/auth';
import type {
  EntityDetail,
  EntitySummary,
  UpdateEntityVariables,
} from '../../src/queries/entities';
import { type KnowledgeProfile, profileQueryOptions } from '../../src/queries/profile';
import { sessionQueryOptions } from '../../src/queries/session';
import { routeTree } from '../../src/routeTree.gen';

test('entity filters survive navigation and keyword changes, and editing clears the stored type', async () => {
  const timestamp = new Date('2026-01-01T00:00:00.000Z');
  const people: EntitySummary[] = ['alice', 'zoe'].map((name) => ({
    readableId: name,
    name,
    description: 'Research colleague',
    entityType: 'person',
    isSelf: false,
    image: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  const profile: KnowledgeProfile = { selfEntity: { ...people[0]!, isSelf: true } };
  const session: Session = {
    session: {
      id: 'session',
      token: 'test-token',
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
  client.setQueryData(profileQueryOptions.queryKey, profile);
  const requests: URL[] = [];
  const updates: UpdateEntityVariables['body'][] = [];
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (...args: Parameters<typeof globalThis.fetch>) => {
        const [input, init] = args;
        const request = new Request(input, init);
        const url = new URL(request.url);
        requests.push(url);
        if (url.pathname === '/api/profile') {
          return Response.json(profile);
        }
        const type = url.searchParams.get('entityType');
        const items = people.filter(
          (person) =>
            !type ||
            type === 'all' ||
            (type === 'untyped' ? person.entityType === null : person.entityType === type),
        );
        if (url.pathname === '/api/entities') {
          return Response.json({ items, total: items.length, nextOffset: null });
        }
        if (url.pathname === '/api/hypermedia/search') {
          return Response.json({
            results: items.map((entity) => ({
              resourceType: 'entity',
              address: `context-use://entity/${entity.readableId}`,
              entity,
              matchExcerpt: null,
            })),
            totalMatches: items.length,
            truncated: false,
          });
        }
        const entity = people.find(
          (person) => url.pathname === `/api/entities/${person.readableId}`,
        );
        if (!entity) {
          throw new Error(`Unexpected request: ${url.pathname}`);
        }
        if (request.method === 'PATCH') {
          const body: UpdateEntityVariables['body'] = await request.json();
          updates.push(body);
          Object.assign(entity, body);
        }
        const detail: EntityDetail = { ...entity, pages: [] };
        return Response.json(detail);
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  try {
    const router = createRouter({
      routeTree,
      context: { queryClient: client },
      history: createMemoryHistory({ initialEntries: ['/entities?entityType=person'] }),
    });
    await router.load();
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: /zoe Person Research colleague/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/entities/zoe'));
    expect(router.state.location.search.entityType).toBe('person');
    await user.click(screen.getByRole('button', { name: 'Filter entities' }));
    expect(await screen.findByRole('combobox', { name: 'Entity type filter' })).toBeTruthy();
    await user.type(screen.getByRole('searchbox', { name: 'Keyword' }), 'research');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ q: 'research', entityType: 'person' }),
    );
    expect(
      requests.some(
        (url) =>
          url.pathname === '/api/hypermedia/search' &&
          url.searchParams.get('entityType') === 'person',
      ),
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(router.state.location.search.q).toBeUndefined());
    expect(router.state.location.search.entityType).toBe('person');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Edit entity' }));
    await user.click(screen.getByRole('combobox', { name: 'Type (optional)' }));
    await user.click(await screen.findByRole('option', { name: 'Untyped' }));
    await user.click(screen.getByRole('button', { name: 'Save entity' }));
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]?.entityType).toBeNull();
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /alice Person Research colleague/ })).toBeNull(),
    );
  } finally {
    cleanup();
    client.clear();
    fetch.mockRestore();
  }
});
