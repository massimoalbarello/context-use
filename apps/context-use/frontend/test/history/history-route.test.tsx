import { expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRouter,
  type Router,
  RouterProvider,
} from '@tanstack/react-router';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from '../../src/lib/auth';
import type { HistoryEntry, HistoryPage } from '../../src/queries/history';
import { type KnowledgeProfile, profileQueryOptions } from '../../src/queries/profile';
import { sessionQueryOptions } from '../../src/queries/session';
import { routeTree } from '../../src/routeTree.gen';

const TODAY = new Date('2026-09-21T12:00:00Z');
function entry(overrides: Partial<HistoryEntry> & { sequence: number }): HistoryEntry {
  const { sequence, ...rest } = overrides;
  return {
    sequence,
    resourceType: 'entity',
    readableId: `person-${sequence}`,
    name: `Person ${sequence}`,
    action: 'updated',
    message: 'Corrected the organization name',
    clientName: 'Research assistant',
    details: ['Name: “Acme” → “Acme Incorporated”'],
    pageRevisionNumber: null,
    createdAt: TODAY,
    available: true,
    ...rest,
  };
}

async function withHistory({
  read,
  run,
  initialEntry = '/history',
}: {
  read: (url: URL) => Response;
  run: (router: Router<typeof routeTree>) => Promise<void>;
  initialEntry?: string;
}) {
  const session: Session = {
    session: {
      id: 'session',
      token: 'test-token',
      userId: 'owner',
      expiresAt: new Date('2099-01-01'),
      createdAt: TODAY,
      updatedAt: TODAY,
    },
    user: {
      id: 'owner',
      name: 'Owner',
      email: 'owner@example.com',
      emailVerified: true,
      createdAt: TODAY,
      updatedAt: TODAY,
    },
  };
  const profile: KnowledgeProfile = {
    selfEntity: {
      readableId: 'owner',
      name: 'Owner',
      description: 'Workspace owner',
      entityType: 'person',
      isSelf: true,
      image: null,
      createdAt: TODAY,
      updatedAt: TODAY,
    },
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(sessionQueryOptions.queryKey, session);
  client.setQueryData(profileQueryOptions.queryKey, profile);
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (...args: Parameters<typeof globalThis.fetch>) => {
        const request = new Request(args[0], args[1]);
        const url = new URL(request.url);
        if (url.pathname === '/api/history') {
          return Promise.resolve(read(url));
        }
        return Promise.reject(new Error(`Unexpected request: ${url.pathname}`));
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  const router = createRouter({
    routeTree,
    context: { queryClient: client },
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  try {
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await run(router);
  } finally {
    cleanup();
    client.clear();
    fetch.mockRestore();
  }
}

test('History preserves daily groups across pages, retries older changes, and keeps deleted names readable', async () => {
  const user = userEvent.setup();
  let olderRequests = 0;
  await withHistory({
    read: (url) => {
      if (!url.searchParams.has('cursor')) {
        return Response.json({
          items: [entry({ sequence: 3 })],
          nextCursor: 'older',
        } satisfies HistoryPage);
      }
      expect(url.searchParams.get('cursor')).toBe('older');
      if (++olderRequests === 1) {
        return Response.json({ error: 'Temporary failure' }, { status: 500 });
      }
      return Response.json({
        items: [
          entry({
            sequence: 2,
            name: 'Removed record',
            resourceType: 'record',
            action: 'deleted',
            available: false,
          }),
          entry({ sequence: 1, createdAt: new Date('2026-09-20T12:00:00Z') }),
        ],
        nextCursor: null,
      } satisfies HistoryPage);
    },
    run: async () => {
      await screen.findByRole('heading', { name: 'History', level: 1 });
      await screen.findByText('Corrected the organization name');
      expect(screen.getByText('by Research assistant')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Load more' }));
      await user.click(await screen.findByRole('button', { name: 'Retry' }));
      await screen.findByText('Removed record');
      const headings = screen.getAllByRole('heading', { level: 2 });
      expect(headings).toHaveLength(2);
      const lists = within(screen.getByRole('main'))
        .getAllByRole('list')
        .filter((list) => list.tagName === 'OL');
      expect(lists).toHaveLength(2);
      expect(
        within(lists[0]!)
          .getAllByRole('listitem')
          .filter((item) => item.parentElement === lists[0]),
      ).toHaveLength(2);
      expect(screen.queryByRole('link', { name: 'Removed record' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
      expect(olderRequests).toBe(2);
    },
  });
});

test('History shows a recoverable initial error and an intentional empty state', async () => {
  let requests = 0;
  const user = userEvent.setup();
  await withHistory({
    read: () =>
      ++requests === 1
        ? Response.json({ error: 'Temporary failure' }, { status: 500 })
        : Response.json({ items: [], nextCursor: null } satisfies HistoryPage),
    run: async () => {
      await screen.findByRole('alert');
      await user.click(screen.getByRole('button', { name: 'Retry' }));
      await waitFor(() =>
        expect(screen.getByText('Your next change starts the story')).toBeTruthy(),
      );
    },
  });
});

test('History shows summaries without previews and links pages to revisions', async () => {
  await withHistory({
    read: () =>
      Response.json({
        items: [
          entry({
            sequence: 2,
            resourceType: 'page',
            readableId: 'notes',
            name: 'Project notes',
            message: 'Clarified the next steps',
            details: ['Content updated'],
            pageRevisionNumber: 2,
            clientName: null,
          }),
          entry({ sequence: 1 }),
        ],
        nextCursor: null,
      } satisfies HistoryPage),
    run: async () => {
      const link = await screen.findByRole('link', { name: 'Project notes' });
      expect(link.getAttribute('href')).toBe('/pages/notes?view=revisions');
      expect(screen.getByText('by Research assistant')).toBeTruthy();
      expect(within(link.closest('li')!).queryByText(/^by\b/)).toBeNull();
      expect(screen.getByText('Clarified the next steps')).toBeTruthy();
      expect(screen.queryByText('Content updated')).toBeNull();
      expect(screen.queryByText('Name: “Acme” → “Acme Incorporated”')).toBeNull();
      expect(screen.queryByRole('button', { name: 'View changes' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Refresh history' })).toBeNull();
      expect(screen.queryByText(/Revision \d/)).toBeNull();
    },
  });
});

test('History filters from the URL, paginates within the filter, and restores it on back navigation', async () => {
  const user = userEvent.setup();
  const requests: { resourceType: string | null; cursor: string | null }[] = [];
  await withHistory({
    initialEntry: '/history?resourceType=page',
    read: (url) => {
      const type = url.searchParams.get('resourceType');
      requests.push({ resourceType: type, cursor: url.searchParams.get('cursor') });
      if (type === 'entity') {
        expect(url.searchParams.has('cursor')).toBe(false);
        return Response.json({ items: [], nextCursor: null } satisfies HistoryPage);
      }
      if (type === 'page') {
        const older = url.searchParams.has('cursor');
        return Response.json({
          items: [
            entry({
              sequence: older ? 1 : 2,
              resourceType: 'page',
              name: older ? 'Older page' : 'Newest page',
            }),
          ],
          nextCursor: older ? null : 'older-pages',
        } satisfies HistoryPage);
      }
      expect(type).toBeNull();
      expect(url.searchParams.has('cursor')).toBe(false);
      return Response.json({
        items: [entry({ sequence: 4, name: 'All resource changes' })],
        nextCursor: null,
      } satisfies HistoryPage);
    },
    run: async (router) => {
      await screen.findByRole('link', { name: 'Newest page' });
      await user.click(screen.getByRole('button', { name: 'Load more' }));
      await screen.findByRole('link', { name: 'Older page' });
      await user.click(screen.getByRole('combobox', { name: 'Resource type' }));
      await user.click(screen.getByRole('option', { name: 'Entities' }));
      await screen.findByText('No changes for this resource type yet');
      expect(router.state.location.search.resourceType).toBe('entity');
      expect(screen.queryByRole('link', { name: 'Newest page' })).toBeNull();
      act(() => router.history.back());
      await screen.findByRole('link', { name: 'Older page' });
      expect(router.state.location.search.resourceType).toBe('page');
      await user.click(screen.getByRole('combobox', { name: 'Resource type' }));
      await user.click(screen.getByRole('option', { name: 'All resources' }));
      await screen.findByRole('link', { name: 'All resource changes' });
      expect(router.state.location.search.resourceType).toBeUndefined();
      expect(requests).toEqual([
        { resourceType: 'page', cursor: null },
        { resourceType: 'page', cursor: 'older-pages' },
        { resourceType: 'entity', cursor: null },
        { resourceType: null, cursor: null },
      ]);
    },
  });
});
