import { expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
}: {
  read: (url: URL) => Response;
  run: () => Promise<void>;
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
        if (url.pathname === '/api/history' || url.pathname === '/api/pages/notes/diff') {
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
    history: createMemoryHistory({ initialEntries: ['/history'] }),
  });
  try {
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await run();
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

test('History hides owner attribution and revision numbers while retaining client names and readable diffs', async () => {
  const user = userEvent.setup();
  const diff: KnowledgePageDiff = {
    from: 1,
    to: 2,
    additions: 1,
    deletions: 1,
    temporalCoverage: null,
    hunks: [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: ['-Original plan', '+Updated plan'],
      },
    ],
  };
  await withHistory({
    read: (url) =>
      url.pathname.endsWith('/diff')
        ? Response.json(diff)
        : Response.json({
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
      await screen.findByRole('heading', { name: 'Project notes', level: 3 });
      expect(screen.getByText('by Research assistant')).toBeTruthy();
      const pageChange = screen
        .getByRole('heading', { name: 'Project notes', level: 3 })
        .closest('li')!;
      expect(within(pageChange).queryByText(/^by\b/)).toBeNull();
      expect(screen.queryByText('Content updated')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'View changes' }));
      await screen.findByText('Updated plan');
      expect(screen.getByText('Content updated')).toBeTruthy();
      expect(screen.queryByText(/Revision \d/)).toBeNull();
    },
  });
});
