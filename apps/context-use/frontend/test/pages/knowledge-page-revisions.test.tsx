import { afterEach, expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KnowledgePageRevisions } from '../../src/components/pages/knowledge-page-revisions';
import type { KnowledgePage, KnowledgePageDiff } from '../../src/queries/pages';

const timestamp = new Date('2026-09-01T12:00:00.000Z');
const page = {
  readableId: 'notes',
  revisionNumber: 2,
  revisions: [
    {
      revisionNumber: 2,
      title: 'Updated notes',
      temporalCoverage: '2025-03/..',
      author: { kind: 'mcp_client', name: 'Research agent' },
      createdAt: timestamp,
    },
    {
      revisionNumber: 1,
      title: 'Initial notes',
      temporalCoverage: null,
      author: { kind: 'owner', name: 'Alex Morgan' },
      createdAt: timestamp,
    },
  ],
} satisfies Pick<KnowledgePage, 'readableId' | 'revisionNumber' | 'revisions'>;

const changed: KnowledgePageDiff = {
  from: 1,
  to: 2,
  additions: 1,
  deletions: 1,
  temporalCoverage: { from: null, to: '2025-03/..' },
  hunks: [
    {
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      lines: ['-Original text', '+<img src=x onerror=alert(1)>'],
    },
  ],
};
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanup();
  for (const dispose of cleanups.splice(0)) {
    dispose();
  }
});

function setup(response: (url: URL) => Promise<Response>) {
  const requests: URL[] = [];
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (input: Parameters<typeof globalThis.fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : input);
        requests.push(url);
        return response(url);
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cleanups.push(() => {
    client.clear();
    fetch.mockRestore();
  });
  const result = render(
    <QueryClientProvider client={client}>
      <KnowledgePageRevisions page={page} publication={null} />
    </QueryClientProvider>,
  );
  return { ...result, requests, user: userEvent.setup() };
}

test('revision history loads adjacent changes on expansion and preserves snapshotted attribution', async () => {
  const initial: KnowledgePageDiff = {
    from: 0,
    to: 1,
    additions: 1,
    deletions: 0,
    temporalCoverage: null,
    hunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, lines: ['+Original text'] }],
  };
  const { user, requests, container } = setup((url) =>
    Promise.resolve(Response.json(url.searchParams.get('to') === '1' ? initial : changed)),
  );
  expect(screen.getByText(/Created by Research agent/)).toBeTruthy();
  expect(screen.getByText(/Created by Alex Morgan/)).toBeTruthy();
  expect(await screen.findByText('Revision 1 → 2')).toBeTruthy();
  expect(screen.getByText('+1 added')).toBeTruthy();
  expect(screen.getByText('−1 removed')).toBeTruthy();
  expect(screen.getByText('Temporal coverage:')).toBeTruthy();
  expect(screen.getByText('Not set')).toBeTruthy();
  expect(screen.getAllByText('Since March 2025 · ongoing').length).toBeGreaterThan(0);
  expect(screen.getByText('<img src=x onerror=alert(1)>', { exact: false })).toBeTruthy();
  expect(container.querySelector('img')).toBeNull();
  expect(requests.map((url) => url.pathname + url.search)).toEqual([
    '/api/pages/notes/diff?from=1&to=2',
  ]);
  const first = screen.getByRole('button', { name: 'Changes in revision 1' });
  expect(first.getAttribute('aria-expanded')).toBe('false');
  await user.click(first);
  expect(await screen.findByText('Full content')).toBeTruthy();
  expect(requests.at(-1)?.search).toBe('?from=0&to=1');
  await user.click(first);
  await user.click(first);
  await screen.findByText('Full content');
  expect(requests).toHaveLength(2);
});

test('failed comparisons can be retried and metadata-only changes remain visible', async () => {
  let fail = true;
  const { user } = setup(() =>
    Promise.resolve(
      fail
        ? Response.json({ error: 'Comparison unavailable' }, { status: 500 })
        : Response.json({
            ...changed,
            additions: 0,
            deletions: 0,
            hunks: [],
            temporalCoverage: { from: '2025', to: null },
          } satisfies KnowledgePageDiff),
    ),
  );
  expect(screen.getByRole('status').textContent).toBe('Loading changes…');
  expect((await screen.findByRole('alert')).textContent).toBe('Comparison unavailable');
  fail = false;
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(await screen.findByText('No content changes.')).toBeTruthy();
  expect(screen.getByText('Temporal coverage:')).toBeTruthy();
  expect(screen.getByText('Not set')).toBeTruthy();
});
