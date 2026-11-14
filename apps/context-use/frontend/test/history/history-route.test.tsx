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
        .getAllByRole('list', { name: '' })
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

test('History combines complete daily page revisions across API pages and links to the Revisions tab', async () => {
  const user = userEvent.setup();
  const requests: string[] = [];
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
      expect(link.getAttribute('href')).toBe('/app/pages/notes?view=revisions');
      expect(screen.queryByRole('button', { name: /^Changes/ })).toBeNull();
      const single = screen.getByRole('link', { name: 'Newest page' }).closest('li')!;
      const singleRevisions = within(single).getByRole('list', { name: 'Revisions that day' });
      const singleRevision = within(singleRevisions).getAllByRole('listitem');
      expect(singleRevision).toHaveLength(1);
      expect(within(singleRevision[0]!).getByText('Created')).toBeTruthy();
      expect(within(singleRevision[0]!).getByText('Created a page')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Load more' }));
      await screen.findByText('Change 3');
      expect(screen.getAllByRole('link', { name: 'Project notes' })).toHaveLength(2);
      expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2);
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
      expect(requests.filter((path) => path.startsWith('/api/history'))).toHaveLength(2);
    },
  });
});

test('History stacks entities, assets, and records by identity and day across API pages', async () => {
  const user = userEvent.setup();
  const resources = [
    { resourceType: 'entity', latestSequence: 10, createdSequence: 6 },
    { resourceType: 'asset', latestSequence: 9, createdSequence: 5 },
    { resourceType: 'record', latestSequence: 8, createdSequence: 4 },
  ] as const;
  await withHistory({
    read: (url) => {
      if (!url.searchParams.has('cursor')) {
        return Response.json({
          items: [
            ...resources.map(({ resourceType, latestSequence }) =>
              entry({
                sequence: latestSequence,
                resourceType,
                readableId: 'shared-id',
                name: `Latest ${resourceType}`,
                action: resourceType === 'record' ? 'deleted' : 'updated',
                available: resourceType !== 'record',
                message: `Latest ${resourceType} change`,
                createdAt: new Date('2026-09-21T18:00:00'),
              }),
            ),
            entry({
              sequence: 7,
              resourceType: 'page',
              readableId: 'shared-id',
              name: 'Separate page',
              pageRevisionNumber: 1,
              action: 'created',
            }),
          ],
          nextCursor: 'same-day',
        } satisfies HistoryPage);
      }
      expect(url.searchParams.get('cursor')).toBe('same-day');
      return Response.json({
        items: [
          ...resources.map(({ resourceType, createdSequence }) =>
            entry({
              sequence: createdSequence,
              resourceType,
              readableId: 'shared-id',
              name: `Original ${resourceType}`,
              action: 'created',
              available: resourceType !== 'record',
              message: `Created ${resourceType}`,
              clientName: null,
              createdAt: new Date('2026-09-21T09:00:00'),
            }),
          ),
          entry({
            sequence: 3,
            readableId: 'shared-id',
            name: 'Yesterday entity',
            message: 'Yesterday change',
            createdAt: new Date('2026-09-20T23:59:00'),
          }),
        ],
        nextCursor: null,
      } satisfies HistoryPage);
    },
    run: async () => {
      await screen.findByRole('heading', { name: 'Latest entity', level: 3 });
      expect(screen.getAllByRole('heading', { level: 3 }).map((item) => item.textContent)).toEqual([
        'Latest entity',
        'Latest asset',
        'Latest record',
        'Separate page',
      ]);
      for (const { resourceType } of resources) {
        const heading = screen.getByRole('heading', { name: `Latest ${resourceType}`, level: 3 });
        const row = heading.closest('li')!;
        const changes = within(
          within(row).getByRole('list', { name: 'Changes that day' }),
        ).getAllByRole('listitem');
        expect(changes).toHaveLength(2);
        expect(within(changes[0]!).getByText(`Latest ${resourceType} change`)).toBeTruthy();
        expect(within(changes[0]!).getByText('by Research assistant')).toBeTruthy();
        expect(
          within(changes[0]!).getByText(resourceType === 'record' ? 'Deleted' : 'Updated'),
        ).toBeTruthy();
        expect(within(changes[1]!).getByText(`Created ${resourceType}`)).toBeTruthy();
        expect(within(changes[1]!).getByText('Created')).toBeTruthy();
        expect(within(changes[1]!).queryByText(/^by\b/)).toBeNull();
        expect(changes.map((item) => item.querySelector('time')?.dateTime)).toEqual([
          new Date('2026-09-21T18:00:00').toISOString(),
          new Date('2026-09-21T09:00:00').toISOString(),
        ]);
        const link = within(row).queryByRole('link');
        if (resourceType === 'record') {
          expect(link).toBeNull();
        } else {
          expect(link?.getAttribute('href')).toBe(
            `/app/${resourceType === 'entity' ? 'entities' : 'assets'}/shared-id`,
          );
        }
      }
      await user.click(screen.getByRole('button', { name: 'Load more' }));
      const yesterday = await screen.findByRole('link', { name: 'Yesterday entity' });
      expect(within(yesterday.closest('li')!).getByText('Yesterday change')).toBeTruthy();
      expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2);
      expect(screen.getAllByRole('heading', { name: 'Latest entity', level: 3 })).toHaveLength(1);
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
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

test('History retries a failed continuation before exposing a partial daily group', async () => {
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
      expect(within(row).getByText('First edit')).toBeTruthy();
      expect(within(row).getByText('Latest edit')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /^Changes/ })).toBeNull();
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
