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
import type { KnowledgePageDiff } from '../../src/queries/pages';
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
  initialEntry = '/app/history',
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
      archivedAt: null,
      publishedAt: null,
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
        if (url.pathname === '/api/history' || url.pathname.endsWith('/diff')) {
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
          items: [
            entry({ sequence: 3 }),
            entry({
              sequence: 2,
              name: 'Removed record',
              resourceType: 'record',
              action: 'deleted',
              message: 'Deleted record',
              clientName: null,
              available: false,
            }),
            entry({ sequence: 1, createdAt: new Date('2026-09-20T12:00:00Z') }),
          ],
          nextCursor: 'older',
        } satisfies HistoryPage);
      }
      expect(url.searchParams.get('cursor')).toBe('older');
      if (++olderRequests === 1) {
        return Response.json({ error: 'Temporary failure' }, { status: 500 });
      }
      return Response.json({
        items: [],
        nextCursor: null,
      } satisfies HistoryPage);
    },
    run: async () => {
      await screen.findByRole('heading', { name: 'History', level: 1 });
      await screen.findByText('Corrected the organization name');
      expect(screen.getByText('by Research assistant')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Load more' }));
      await user.click(await screen.findByRole('button', { name: 'Retry' }));
      await screen.findByRole('link', { name: 'Person 1' });
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

test('History combines complete daily page revisions across API pages and compares the full day on demand', async () => {
  const user = userEvent.setup();
  const requests: string[] = [];
  let comparisons = 0;
  const revision = (
    overrides: Partial<HistoryEntry> & { sequence: number; pageRevisionNumber: number },
  ) =>
    entry({
      resourceType: 'page',
      readableId: 'notes',
      name: 'Project notes',
      message: `Change ${overrides.pageRevisionNumber}`,
      clientName: `Assistant ${overrides.pageRevisionNumber}`,
      ...overrides,
    });
  await withHistory({
    read: (url) => {
      requests.push(url.pathname + url.search);
      if (url.pathname.endsWith('/diff')) {
        if (++comparisons === 1) {
          return Response.json({ error: 'Comparison unavailable' }, { status: 500 });
        }
        return Response.json({
          from: Number(url.searchParams.get('from')),
          to: Number(url.searchParams.get('to')),
          additions: 1,
          deletions: 1,
          temporalCoverage: null,
          hunks: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              lines: ['-Before the day', '+Final content'],
            },
          ],
        } satisfies KnowledgePageDiff);
      }
      if (!url.searchParams.has('cursor')) {
        return Response.json({
          items: [
            entry({
              sequence: 9,
              resourceType: 'page',
              readableId: 'new-page',
              name: 'Newest page',
              action: 'created',
              message: 'Created a page',
              pageRevisionNumber: 1,
              createdAt: new Date('2026-09-21T23:10:00'),
            }),
            revision({
              sequence: 8,
              pageRevisionNumber: 6,
              createdAt: new Date('2026-09-21T22:50:00'),
            }),
            entry({
              sequence: 7,
              readableId: 'notes',
              name: 'Unrelated entity',
              createdAt: new Date('2026-09-21T22:40:00'),
            }),
            revision({
              sequence: 6,
              pageRevisionNumber: 5,
              clientName: null,
              createdAt: new Date('2026-09-21T10:00:00'),
            }),
          ],
          nextCursor: 'same-day',
        } satisfies HistoryPage);
      }
      expect(url.searchParams.get('cursor')).toBe('same-day');
      return Response.json({
        items: [
          revision({
            sequence: 5,
            pageRevisionNumber: 4,
            createdAt: new Date('2026-09-21T00:01:00'),
          }),
          entry({
            sequence: 4,
            resourceType: 'page',
            readableId: 'notes',
            name: 'Restored notes',
            action: 'unarchived',
            message: 'Restored the page',
            createdAt: new Date('2026-09-21T00:00:30'),
          }),
          revision({
            sequence: 3,
            pageRevisionNumber: 3,
            createdAt: new Date('2026-09-20T23:59:00'),
          }),
          revision({
            sequence: 2,
            pageRevisionNumber: 2,
            createdAt: new Date('2026-09-20T23:58:00'),
          }),
        ],
        nextCursor: null,
      } satisfies HistoryPage);
    },
    run: async () => {
      const link = await screen.findByRole('link', { name: 'Project notes' });
      expect(requests).toEqual(['/api/history', '/api/history?cursor=same-day']);
      const row = link.closest('li')!;
      const dayList = row.parentElement!;
      expect(
        within(dayList)
          .getAllByRole('heading', { level: 3 })
          .map((heading) => heading.textContent),
      ).toEqual(['Newest page', 'Project notes', 'Unrelated entity', 'Restored notes']);
      expect(within(row).getByText('3 revisions')).toBeTruthy();
      const messages = within(row).getByRole('list', { name: 'Revisions that day' });
      const revisions = within(messages).getAllByRole('listitem');
      for (const revision of revisions) {
        expect(within(revision).getByText('Updated')).toBeTruthy();
      }
      expect(revisions.map((item) => item.querySelector('p')?.textContent)).toEqual([
        'Change 6',
        'Change 5',
        'Change 4',
      ]);
      expect(revisions.map((item) => item.querySelector('time')?.dateTime)).toEqual([
        new Date('2026-09-21T22:50:00').toISOString(),
        new Date('2026-09-21T10:00:00').toISOString(),
        new Date('2026-09-21T00:01:00').toISOString(),
      ]);
      expect(within(revisions[0]!).getByText('by Assistant 6')).toBeTruthy();
      expect(within(revisions[1]!).queryByText(/^by\b/)).toBeNull();
      expect(within(revisions[2]!).getByText('by Assistant 4')).toBeTruthy();
      const changes = within(row).getByRole('button', { name: /^Changes to/ });
      expect(changes.getAttribute('aria-expanded')).toBe('false');
      await user.click(changes);
      await screen.findByRole('alert');
      await user.click(screen.getByRole('button', { name: 'Retry' }));
      await screen.findByText('Revision 3 → 6');
      expect(screen.getByText('Final content')).toBeTruthy();
      expect(requests.slice(2)).toEqual([
        '/api/pages/notes/diff?from=3&to=6',
        '/api/pages/notes/diff?from=3&to=6',
      ]);
      await user.click(changes);
      await user.click(changes);
      await screen.findByText('Revision 3 → 6');
      expect(comparisons).toBe(2);
      const newPage = screen.getByRole('link', { name: 'Newest page' }).closest('li')!;
      await user.click(within(newPage).getByRole('button', { name: /^Changes to/ }));
      await screen.findByText('Full content');
      expect(requests.at(-1)).toBe('/api/pages/new-page/diff?from=0&to=1');
      await user.click(screen.getByRole('button', { name: 'Load more' }));
      await screen.findByText('Change 3');
      expect(screen.getAllByRole('link', { name: 'Project notes' })).toHaveLength(2);
      expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2);
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
      expect(requests.filter((path) => path.startsWith('/api/history'))).toHaveLength(2);
      const yesterday = screen.getAllByRole('link', { name: 'Project notes' })[1]!.closest('li')!;
      await user.click(within(yesterday).getByRole('button', { name: /^Changes to/ }));
      await screen.findByText('Revision 1 → 3');
      expect(requests.at(-1)).toBe('/api/pages/notes/diff?from=1&to=3');
    },
  });
});

test('History preserves creation and unavailable revisions in one daily item without offering an unavailable diff', async () => {
  await withHistory({
    read: () =>
      Response.json({
        items: [
          entry({
            sequence: 3,
            resourceType: 'page',
            readableId: 'removed',
            name: 'Deleted notes',
            pageRevisionNumber: 2,
            message: 'Revised the notes',
            available: false,
          }),
          entry({
            sequence: 2,
            resourceType: 'page',
            readableId: 'removed',
            name: 'Original title',
            pageRevisionNumber: 1,
            action: 'created',
            message: 'Created the notes',
            available: false,
          }),
          entry({
            sequence: 1,
            resourceType: 'page',
            readableId: 'removed',
            name: 'Archived notes',
            action: 'archived',
            message: 'Archived the notes',
            available: false,
          }),
        ],
        nextCursor: null,
      } satisfies HistoryPage),
    run: async () => {
      const title = await screen.findByRole('heading', { name: 'Deleted notes', level: 3 });
      const row = title.closest('li')!;
      const revisions = within(
        within(row).getByRole('list', { name: 'Revisions that day' }),
      ).getAllByRole('listitem');
      expect(within(revisions[0]!).getByText('Updated')).toBeTruthy();
      expect(within(revisions[1]!).getByText('Created')).toBeTruthy();
      expect(within(row).getByText('2 revisions')).toBeTruthy();
      expect(within(row).getByText('Created the notes')).toBeTruthy();
      expect(within(row).getByText('Revised the notes')).toBeTruthy();
      expect(screen.getByText('Archived the notes')).toBeTruthy();
      expect(screen.queryByRole('link', { name: 'Deleted notes' })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Changes to/ })).toBeNull();
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

test('History retries a failed continuation before exposing a partial daily comparison', async () => {
  const user = userEvent.setup();
  let continuations = 0;
  await withHistory({
    read: (url) => {
      if (!url.searchParams.has('cursor')) {
        return Response.json({
          items: [
            entry({
              sequence: 2,
              resourceType: 'page',
              readableId: 'notes',
              name: 'Daily notes',
              pageRevisionNumber: 2,
              message: 'Latest edit',
            }),
          ],
          nextCursor: 'mid-day',
        } satisfies HistoryPage);
      }
      expect(url.searchParams.get('cursor')).toBe('mid-day');
      if (++continuations === 1) {
        return Response.json({ error: 'Temporary failure' }, { status: 500 });
      }
      return Response.json({
        items: [
          entry({
            sequence: 1,
            resourceType: 'page',
            readableId: 'notes',
            name: 'Daily notes',
            pageRevisionNumber: 1,
            action: 'created',
            message: 'First edit',
          }),
        ],
        nextCursor: null,
      } satisfies HistoryPage);
    },
    run: async () => {
      await screen.findByRole('alert');
      expect(screen.queryByRole('link', { name: 'Daily notes' })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Changes to/ })).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Retry' }));
      const row = (await screen.findByRole('link', { name: 'Daily notes' })).closest('li')!;
      expect(within(row).getByText('2 revisions')).toBeTruthy();
      expect(within(row).getByText('First edit')).toBeTruthy();
      expect(within(row).getByText('Latest edit')).toBeTruthy();
      expect(within(row).getByRole('button', { name: /^Changes to/ })).toBeTruthy();
      expect(continuations).toBe(2);
    },
  });
});

test('History shows summaries without previews and links pages to revisions', async () => {
  await withHistory({
    read: () =>
      Response.json({
        items: [
          entry({
            sequence: 3,
            resourceType: 'page',
            readableId: 'restored-notes',
            name: 'Restored project notes',
            action: 'unarchived',
            message: 'Unarchived page from the dashboard',
            clientName: null,
            details: [],
          }),
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
      expect(link.getAttribute('href')).toBe('/app/pages/notes?view=revisions');
      expect(screen.getByText('by Research assistant')).toBeTruthy();
      expect(within(link.closest('li')!).queryByText(/^by\b/)).toBeNull();
      expect(screen.getByText('Clarified the next steps')).toBeTruthy();
      expect(screen.getByText('Unarchived')).toBeTruthy();
      expect(screen.getByText('Unarchived page from the dashboard')).toBeTruthy();
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
    initialEntry: '/app/history?resourceType=page',
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
          items: older
            ? []
            : [
                entry({
                  sequence: 2,
                  resourceType: 'page',
                  name: 'Newest page',
                }),
                entry({
                  sequence: 1,
                  resourceType: 'page',
                  name: 'Older page',
                  createdAt: new Date('2026-09-20T12:00:00Z'),
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
