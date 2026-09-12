import { afterEach, expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KnowledgePageForm } from '../../src/components/pages/knowledge-page-form';
import type { api } from '../../src/lib/api';

type SearchResponse = NonNullable<
  Awaited<ReturnType<typeof api.api.hypermedia.search.get>>['data']
>;
const timestamp = new Date('2026-09-12');
function entityHit(name: string): SearchResponse['results'][number] {
  return {
    resourceType: 'entity',
    address: `context-use://entity/${name}`,
    entity: {
      readableId: name,
      name,
      description: 'A colleague',
      entityType: null,
      isSelf: false,
      image: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    matchExcerpt: null,
  };
}
function response(results: SearchResponse['results'] = []): SearchResponse {
  return { results, totalMatches: results.length, truncated: false };
}
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanup();
  for (const dispose of cleanups.splice(0)) {
    dispose();
  }
});
function setup(search: (url: URL) => Promise<Response>) {
  const requests: URL[] = [];
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (input: Parameters<typeof globalThis.fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : input);
        requests.push(url);
        if (url.pathname === '/api/hypermedia/search') {
          return search(url);
        }
        throw new Error(`Unexpected picker request: ${url.pathname}`);
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cleanups.push(() => {
    client.clear();
    fetch.mockRestore();
  });
  render(
    <QueryClientProvider client={client}>
      <KnowledgePageForm
        initialValues={{ markdown: '# Evidence\n\n', temporalCoverage: null }}
        pending={false}
        error={null}
        header={() => <h1>New page</h1>}
        submitLabel="Create page"
        onSubmit={() => undefined}
      />
    </QueryClientProvider>,
  );
  return {
    user: userEvent.setup(),
    textarea: screen.getByRole('combobox', { name: 'Knowledge page content' }),
    requests,
  };
}

test('the picker waits for a query, stays open during search, and inserts the result', async () => {
  const pending = Promise.withResolvers<Response>();
  const { user, textarea, requests } = setup(() =>
    pending.promise.then((result) => result.clone()),
  );
  await user.type(textarea, '@');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(textarea.getAttribute('aria-expanded')).toBe('false');
  expect(requests).toHaveLength(0);
  await user.type(textarea, 'b');
  expect(requests.at(-1)?.searchParams.get('query')).toBe('b');
  await user.type(textarea, 'uried');
  expect(screen.getByRole('listbox')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('Searching all resources…');
  expect(textarea.getAttribute('aria-expanded')).toBe('true');
  expect(screen.queryByRole('option')).toBeNull();
  expect(document.activeElement).toBe(textarea);
  // Empty loading states must not corrupt the active selection.
  await user.keyboard('{ArrowDown}{ArrowUp}');
  await Promise.resolve(
    act(() => {
      pending.resolve(Response.json(response([entityHit('Zoe')])));
      return pending.promise;
    }),
  );
  const match = await screen.findByRole('option', { name: /Zoe/ });
  expect(match.getAttribute('aria-selected')).toBe('true');
  const searches = requests.filter((url) => url.pathname === '/api/hypermedia/search');
  expect(searches.at(-1)?.searchParams.get('query')).toBe('buried');
  expect(searches.every((url) => !url.searchParams.has('resourceTypes'))).toBe(true);
  await user.keyboard('{Enter}');
  expect((textarea as HTMLTextAreaElement).value).toBe(
    '# Evidence\n\n[Zoe](context-use://entity/Zoe) ',
  );
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(textarea.hasAttribute('aria-activedescendant')).toBe(false);
});

test('clearing the query closes the picker without fetching initial suggestions', async () => {
  const { user, textarea, requests } = setup(async () =>
    Response.json(response([entityHit('Found')])),
  );
  await user.type(textarea, '@x');
  await screen.findByRole('option', { name: /Found/ });
  const requestCount = requests.length;
  await user.keyboard('{Backspace}');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(textarea.getAttribute('aria-expanded')).toBe('false');
  expect(textarea.hasAttribute('aria-activedescendant')).toBe(false);
  expect(requests).toHaveLength(requestCount);
  await user.type(textarea, '  ');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(requests).toHaveLength(requestCount);
  await user.keyboard('{Enter}');
  expect((textarea as HTMLTextAreaElement).value).toBe('# Evidence\n\n@  \n');
});

test('a search completing after its query is deleted cannot reopen the picker', async () => {
  const pending = Promise.withResolvers<Response>();
  const { user, textarea, requests } = setup(() => pending.promise);
  await user.type(textarea, '@x');
  expect(screen.getByRole('status').textContent).toContain('Searching');
  await user.keyboard('{Backspace}');
  await Promise.resolve(
    act(() => {
      pending.resolve(Response.json(response([entityHit('Obsolete')])));
      return pending.promise;
    }),
  );
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(requests).toHaveLength(1);
  expect((textarea as HTMLTextAreaElement).value).toBe('# Evidence\n\n@');
});

test('mixed BM25 order and more than seven matches of one type are preserved with truncation visible', async () => {
  const entityMatchCount = 9;
  const results: SearchResponse['results'] = [
    {
      resourceType: 'record',
      address: 'context-use://record/decision',
      matchExcerpt: 'Body evidence',
      record: {
        readableId: 'decision',
        title: 'Source decision',
        provider: 'github',
        participantNames: [],
        kind: 'issue',
        recordId: '42',
        sync: { readableId: 'sync', name: 'Source' },
        sourceCreatedAt: null,
        sourceUpdatedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
    {
      resourceType: 'knowledge_page',
      address: 'context-use://page/notes',
      matchExcerpt: 'Body evidence',
      knowledgePage: {
        readableId: 'notes',
        title: 'Research notes',
        excerpt: 'Research overview',
        revisionNumber: 1,
        temporalCoverage: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
    {
      resourceType: 'asset',
      address: 'context-use://asset/report',
      matchExcerpt: null,
      asset: {
        readableId: 'report',
        name: 'Evidence report',
        mediaType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 100,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
    ...Array.from(Array(entityMatchCount).keys(), (index) => entityHit(`Colleague ${index}`)),
  ];
  const { user, textarea } = setup(async () =>
    Response.json({ results, totalMatches: 80, truncated: true } satisfies SearchResponse),
  );
  await user.type(textarea, '@evidence');
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(results.length));
  const options = screen.getAllByRole('option');
  expect(options[0]?.textContent).toContain('Source decision');
  expect(options[1]?.textContent).toContain('Research notes');
  expect(options[2]?.textContent).toContain('Evidence report');
  expect(options.at(-1)?.textContent).toContain('Colleague 8');
  expect(screen.getByRole('status').textContent).toContain('Showing 12 of 80 matches');
  await user.keyboard('{ArrowDown}{Tab}');
  expect((textarea as HTMLTextAreaElement).value).toBe(
    '# Evidence\n\n[Research notes](context-use://page/notes) ',
  );
});

test('no matches stays visible and Escape dismisses it without changing the draft', async () => {
  const { user, textarea } = setup(async () => Response.json(response()));
  await user.type(textarea, '@missing');
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('No matching'));
  expect(screen.getByRole('listbox')).toBeTruthy();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect((textarea as HTMLTextAreaElement).value).toBe('# Evidence\n\n@missing');
});

test('failed searches remain visible and can be retried without losing the query or draft', async () => {
  let fail = true;
  const { user, textarea } = setup(async () =>
    fail
      ? Response.json({ error: 'Search unavailable' }, { status: 500 })
      : Response.json(response([entityHit('Recovered')])),
  );
  await user.type(textarea, '@lookup');
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Couldn’t search'));
  fail = false;
  await user.keyboard('{Tab}');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' }));
  await user.keyboard('{Enter}');
  await screen.findByRole('option', { name: /Recovered/ });
  expect(document.activeElement).toBe(textarea);
  expect((textarea as HTMLTextAreaElement).value).toBe('# Evidence\n\n@lookup');
});

test('a late response cannot replace the results of a newer search', async () => {
  const older = Promise.withResolvers<Response>();
  const { user, textarea } = setup(async (url) =>
    url.searchParams.get('query') === 'old'
      ? older.promise
      : Response.json(response([entityHit('Current')])),
  );
  await user.type(textarea, '@old');
  await user.type(textarea, 'er');
  await screen.findByRole('option', { name: /Current/ });
  await Promise.resolve(
    act(() => {
      older.resolve(Response.json(response([entityHit('Obsolete')])));
      return older.promise;
    }),
  );
  expect(screen.queryByRole('option', { name: /Obsolete/ })).toBeNull();
  expect(screen.getByRole('option', { name: /Current/ })).toBeTruthy();
  await user.click(screen.getByRole('heading', { name: 'New page' }));
  expect(screen.queryByRole('listbox')).toBeNull();
});

test('replacing the draft with a pasted query searches the text at the current caret', async () => {
  const { user, textarea, requests } = setup(async () =>
    Response.json(response([entityHit('Found')])),
  );
  await user.click(textarea);
  await user.keyboard('{Control>}a{/Control}');
  await user.paste('# Revised evidence\n\n@pasted');
  await screen.findByRole('option', { name: /Found/ });
  expect(textarea.getAttribute('aria-expanded')).toBe('true');
  expect(requests.at(-1)?.searchParams.get('query')).toBe('pasted');
  await user.keyboard('{Enter}');
  expect((textarea as HTMLTextAreaElement).value).toBe(
    '# Revised evidence\n\n[Found](context-use://entity/Found) ',
  );
});
