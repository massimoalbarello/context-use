import { afterEach, expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KnowledgePageDetail } from '../../src/components/pages/page-detail';
import {
  type KnowledgePage,
  type KnowledgePageDiff,
  pageQueryOptions,
  pagesListQueryKey,
} from '../../src/queries/pages';
import {
  type PublicationBlocker,
  type PublicationReady,
  type PublicationRequest,
  publicationStatusQueryOptions,
} from '../../src/queries/publications';
import { authenticator, deferred } from './passkey-device';

const APPROVAL_LIFETIME_MS = 120_000;
const SELECTED_REVISION = 3;
const LATER_REVISION = 4;
const FIRST_PUBLIC_REVISION = 7;
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanup();
  for (const dispose of cleanups.splice(0).reverse()) {
    dispose();
  }
});

function changes({ from, to }: { from: number; to: number }): KnowledgePageDiff {
  return {
    from,
    to,
    additions: 1,
    deletions: from === 0 ? 0 : 1,
    temporalCoverage: null,
    hunks: [
      {
        oldStart: 1,
        oldLines: from === 0 ? 0 : 1,
        newStart: 1,
        newLines: 1,
        lines: [...(from === 0 ? [] : [`-Public text ${from}`]), `+Selected text ${to}`],
      },
    ],
  };
}

async function renderPage({
  published = null,
  revision = 3,
  statusError = false,
}: {
  published?: number | null;
  revision?: number;
  statusError?: boolean;
} = {}) {
  const timestamp = new Date('2026-01-01');
  const page: KnowledgePage = {
    readableId: 'notes',
    title: 'Cached title',
    excerpt: 'Notes',
    revisionNumber: revision,
    markdown: '# Cached title\n\nPrivate text',
    temporalCoverage: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    mentions: [],
    references: [],
    backlinks: [],
    recordReferences: [],
    assetUsages: [],
    revisions: Array.from(Array(revision).keys(), (index) => ({
      revisionNumber: revision - index,
      title: `Revision title ${revision - index}`,
      temporalCoverage: null,
      author: { kind: 'owner', name: 'Alex Morgan' },
      createdAt: timestamp,
    })),
  };
  const state = {
    publication: {
      resourceType: 'page' as const,
      publicId: published == null ? null : 'page_handle',
      publishedAt: published == null ? null : timestamp.toISOString(),
      publishedRevisionNumber: published,
    },
    pageError: false,
    statusError,
    blockers: [] as PublicationBlocker[],
    completeError: false,
    begins: [] as PublicationRequest[],
    ready: [] as PublicationReady[],
    completes: [] as string[],
    comparisons: [] as { from: number; to: number }[],
    diffResponse: undefined as
      | ((comparison: { from: number; to: number }) => Response | Promise<Response>)
      | undefined,
    preparedTitle: 'Prepared title',
  };
  const device = authenticator(cleanups);
  async function detail(request: Request) {
    if (state.pageError) {
      return Response.json({ error: 'Page unavailable' }, { status: 503 });
    }
    if (request.method === 'PUT') {
      const body = await request.json();
      page.markdown = body.markdown;
      page.revisionNumber++;
    }
    return Response.json(page);
  }
  async function begin(request: Request) {
    const body: PublicationRequest = await request.json();
    state.begins.push(body);
    if (state.blockers.length) {
      return Response.json(
        {
          state: 'blocked',
          error: 'Resolve publication dependencies.',
          blockers: state.blockers,
        },
        { status: 409 },
      );
    }
    const ready: PublicationReady = {
      state: 'ready',
      approvalId: `approval-${state.begins.length}`,
      expiresAt: new Date(Date.now() + APPROVAL_LIFETIME_MS).toISOString(),
      options: {
        challenge: state.begins.length === 1 ? 'AQ' : 'Ag',
        rpId: 'localhost',
        userVerification: 'required',
      },
      preparation: {
        resource: { resourceType: 'page', readableId: 'notes', name: state.preparedTitle },
        publication: {
          publicId: state.publication.publicId,
          publishedAt: state.publication.publishedAt,
        },
        pageRevision: {
          revisionNumber:
            body.resourceType === 'page' && body.action === 'publish' ? body.revisionNumber : null,
          publishedRevisionNumber: state.publication.publishedRevisionNumber,
        },
        includedImage: null,
        entityIdentity: null,
        blockers: [],
      },
    };
    state.ready.push(ready);
    return Response.json(ready);
  }
  function complete(url: URL) {
    const approvalId = url.pathname.split('/').at(-2)!;
    state.completes.push(approvalId);
    if (state.completeError) {
      return Response.json(
        { state: 'state_changed', error: 'The reviewed state changed. Review again.' },
        { status: 409 },
      );
    }
    const preparation = state.ready.find((ready) => ready.approvalId === approvalId)!.preparation;
    const selected = preparation.pageRevision!.revisionNumber;
    state.publication = {
      resourceType: 'page',
      publicId: 'page_handle',
      publishedAt: selected == null ? null : timestamp.toISOString(),
      publishedRevisionNumber: selected,
    };
    return Response.json({ state: 'changed', publication: state.publication });
  }
  const handlers: Record<string, (request: Request) => Response | Promise<Response>> = {
    '/api/pages/notes': detail,
    '/api/publications/approvals': begin,
    '/api/publications/page/notes': () =>
      state.statusError
        ? Response.json({ error: 'Status unavailable' }, { status: 503 })
        : Response.json(state.publication),
    '/api/pages/notes/archive': () =>
      state.publication.publishedAt
        ? Response.json({ error: 'Unpublish this resource before archiving it.' }, { status: 409 })
        : new Response(null, { status: 204 }),
    '/api/pages/notes/diff': (request) => {
      const url = new URL(request.url);
      const from = Number(url.searchParams.get('from'));
      const to = Number(url.searchParams.get('to'));
      state.comparisons.push({ from, to });
      return state.diffResponse
        ? state.diffResponse({ from, to })
        : Response.json(changes({ from, to }));
    },
  };
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (...args: Parameters<typeof globalThis.fetch>) => {
        const request = new Request(...args);
        const url = new URL(request.url);
        if (url.pathname.endsWith('/complete')) {
          return complete(url);
        }
        const handler = handlers[url.pathname];
        if (!handler) {
          throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
        }
        return await handler(request);
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(pagesListQueryKey, []);
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: '/pages/$id',
    validateSearch: (search: { view?: 'preview' | 'links' | 'revisions' }) => search,
    component: () => {
      const { view } = route.useSearch();
      const navigate = route.useNavigate();
      return (
        <KnowledgePageDetail
          id="notes"
          view={view}
          onViewChange={(options) => void navigate({ search: options })}
          onArchived={() => undefined}
        />
      );
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/pages/notes'] }),
  });
  await router.load();
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  cleanups.push(
    () => client.clear(),
    () => fetch.mockRestore(),
  );
  await screen.findByRole('button', {
    name: statusError ? 'Retry publication status' : published == null ? 'Publish' : 'Unpublish',
  });
  return { page, state, client, device, router, user: userEvent.setup() };
}

async function refreshPage(client: QueryClient) {
  // biome-ignore lint/nursery/useAwaitThenable: React act intentionally returns a thenable.
  await act(async () => {
    await client.invalidateQueries(pageQueryOptions('notes'));
  });
}

async function confirm(user: ReturnType<typeof userEvent.setup>) {
  const button = await screen.findByRole('button', { name: 'Confirm with passkey' });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  await user.click(button);
}

test('first publication reviews full selected content before allowing confirmation and withdraws with fresh approval', async () => {
  const { state, user, device, client } = await renderPage({ revision: 7 });
  expect(
    screen
      .getByRole('button', { name: 'Publish' })
      .compareDocumentPosition(screen.getByRole('button', { name: 'Edit page' })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  const response = deferred<Response>();
  state.diffResponse = () => response.promise;
  await user.click(screen.getByRole('button', { name: 'Publish' }));
  const dialog = await screen.findByRole('dialog', { name: 'Publish page' });
  expect(within(dialog).getByText('Prepared title')).toBeTruthy();
  expect(
    within(dialog).getByText(
      'Anyone with the link can read this page. Future edits stay private until you publish them.',
    ),
  ).toBeTruthy();
  await screen.findByText('Loading changes…');
  const button = screen.getByRole('button', { name: 'Confirm with passkey' });
  expect(button.hasAttribute('disabled')).toBe(true);
  await user.click(button);
  expect(device.calls).toHaveLength(0);
  response.resolve(Response.json(changes({ from: 0, to: FIRST_PUBLIC_REVISION })));
  await screen.findByText('Full content');
  expect(state.comparisons).toEqual([{ from: 0, to: 7 }]);
  await confirm(user);
  await screen.findByRole('button', { name: 'Unpublish' });
  expect(
    screen
      .getByRole('button', { name: 'Unpublish' })
      .compareDocumentPosition(screen.getByRole('button', { name: 'Edit page' })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Unpublished revisions' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Publish changes' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'View public' })).toBeNull();
  expect(screen.queryByText('Public')).toBeNull();
  expect(screen.queryByText('Public revision 7')).toBeNull();
  expect(client.getQueryState(pagesListQueryKey)?.isInvalidated).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Unpublish' }));
  expect(await screen.findByText(/public URL and in public entity page indices/)).toBeTruthy();
  expect(screen.getByText(/keep their own publication state/)).toBeTruthy();
  await confirm(user);
  await screen.findByText('Private');
  expect(screen.queryByRole('link', { name: 'View public' })).toBeNull();
  expect(state.begins).toEqual([
    { resourceType: 'page', readableId: 'notes', action: 'publish', revisionNumber: 7 },
    { resourceType: 'page', readableId: 'notes', action: 'unpublish' },
  ]);
  expect(state.completes).toEqual(['approval-1', 'approval-2']);
  expect(state.comparisons).toHaveLength(1);
  expect(device.calls).toHaveLength(2);
});

test('skipped private revisions compare active public to selected and a later revision cannot retarget the review', async () => {
  const { state, user, page, client, router } = await renderPage({ published: 1 });
  expect(screen.queryByText('Public')).toBeNull();
  expect(screen.queryByText('Public revision 1')).toBeNull();
  expect(screen.queryByRole('link', { name: 'View public' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Publish changes' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Unpublished revisions' }));
  expect(router.state.location.search).toEqual({ view: 'revisions' });
  expect(screen.getByRole('tab', { name: 'Revisions' }).getAttribute('aria-selected')).toBe('true');
  expect(
    within(screen.getByRole('listitem', { name: 'Revision 1' })).getByText('Public'),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Publish revision 1' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Publish revision 3' }));
  const dialog = await screen.findByRole('dialog', { name: 'Publish page' });
  await screen.findByText('Revision 1 → 3');
  expect(state.comparisons).toEqual([
    { from: 2, to: 3 },
    { from: 1, to: 3 },
  ]);
  page.revisionNumber = LATER_REVISION;
  page.markdown = '# New private title\n\nNew private text';
  await refreshPage(client);
  expect(within(dialog).getByText('Prepared title')).toBeTruthy();
  expect(within(dialog).getByText('Revision 1 → 3')).toBeTruthy();
  expect(within(dialog).queryByText('New private title')).toBeNull();
  await confirm(user);
  await waitFor(() =>
    expect(
      within(screen.getByRole('listitem', { name: 'Revision 3' })).getByText('Public'),
    ).toBeTruthy(),
  );
  expect(screen.getByRole('button', { name: 'Unpublished revisions' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Publish revision 3' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Publish revision 1' })).toBeTruthy();
  expect(state.publication.publishedRevisionNumber).toBe(SELECTED_REVISION);
  expect(state.begins).toHaveLength(1);
});

test('a changed public baseline requires renewed approval with the matching cached comparison', async () => {
  const { state, user, device } = await renderPage({ published: 1 });
  await user.click(screen.getByRole('tab', { name: 'Revisions' }));
  await user.click(screen.getByRole('button', { name: 'Publish revision 3' }));
  await screen.findByText('Revision 1 → 3');
  state.publication.publishedRevisionNumber = 2;
  state.completeError = true;
  await confirm(user);
  await screen.findByRole('button', { name: 'Review again' });
  expect(state.begins).toHaveLength(1);
  state.completeError = false;
  await user.click(screen.getByRole('button', { name: 'Review again' }));
  await within(screen.getByRole('dialog')).findByText('Revision 2 → 3');
  expect(screen.queryByText('Revision 1 → 3')).toBeNull();
  expect(state.comparisons).toEqual([
    { from: 2, to: 3 },
    { from: 1, to: 3 },
  ]);
  expect(device.calls).toHaveLength(1);
  await confirm(user);
  await waitFor(() =>
    expect(
      within(screen.getByRole('listitem', { name: 'Revision 3' })).getByText('Public'),
    ).toBeTruthy(),
  );
  expect(state.completes).toEqual(['approval-1', 'approval-2']);
  expect(new Uint8Array(device.calls[1]!.publicKey!.challenge as ArrayBuffer)).toEqual(
    new Uint8Array([2]),
  );
});

test('publishing an older revision reviews that exact revision and moves the public marker only after approval', async () => {
  const { state, user, device } = await renderPage({ published: 3 });
  expect(screen.queryByRole('button', { name: 'Unpublished revisions' })).toBeNull();
  await user.click(screen.getByRole('tab', { name: 'Revisions' }));
  const current = within(screen.getByRole('listitem', { name: 'Revision 3' }));
  expect(current.getByText('Public')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Publish revision 1' }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Publish page' }));
  await dialog.findByText('Revision 3 → 1');
  expect(state.begins).toEqual([
    { resourceType: 'page', readableId: 'notes', action: 'publish', revisionNumber: 1 },
  ]);
  expect(state.publication.publishedRevisionNumber).toBe(SELECTED_REVISION);
  expect(device.calls).toHaveLength(0);
  await confirm(user);
  await waitFor(() =>
    expect(
      within(screen.getByRole('listitem', { name: 'Revision 1' })).getByText('Public'),
    ).toBeTruthy(),
  );
  expect(current.queryByText('Public')).toBeNull();
  expect(screen.getByRole('button', { name: 'Unpublished revisions' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Publish revision 3' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Publish revision 1' })).toBeNull();
});

test('revision publishing and public markers wait for publication status to recover', async () => {
  const { state, user } = await renderPage({ published: 1, statusError: true });
  await user.click(screen.getByRole('tab', { name: 'Revisions' }));
  expect(screen.queryByText('Public')).toBeNull();
  expect(screen.queryByRole('button', { name: /Publish revision/ })).toBeNull();
  await screen.findByText('Revision 2 → 3');
  state.statusError = false;
  await user.click(screen.getByRole('button', { name: 'Retry publication status' }));
  await screen.findByRole('button', { name: 'Publish revision 3' });
  expect(
    within(screen.getByRole('listitem', { name: 'Revision 1' })).getByText('Public'),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Publish revision 1' })).toBeNull();
});

test('comparison failure prevents approval until retry succeeds without changing the reviewed challenge', async () => {
  const { state, user, device } = await renderPage();
  state.diffResponse = () => Response.json({ error: 'Comparison unavailable' }, { status: 503 });
  await user.click(screen.getByRole('button', { name: 'Publish' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Comparison unavailable');
  expect(
    screen.getByRole('button', { name: 'Confirm with passkey' }).hasAttribute('disabled'),
  ).toBe(true);
  expect(device.calls).toHaveLength(0);
  state.diffResponse = undefined;
  await user.click(screen.getByRole('button', { name: 'Retry changes' }));
  await screen.findByText('Full content');
  await confirm(user);
  await screen.findByRole('button', { name: 'Unpublish' });
  expect(state.begins).toHaveLength(1);
  expect(state.completes).toEqual(['approval-1']);
});

test('private resources stay collapsed and OK returns to the page before publishing again', async () => {
  const { state, user, device } = await renderPage();
  state.blockers = [
    {
      reason: 'reference_not_public',
      resource: { resourceType: 'record', readableId: 'source', name: 'Private source' },
    },
    {
      reason: 'reference_not_public',
      resource: { resourceType: 'entity', readableId: 'studio', name: 'Private studio' },
    },
    {
      reason: 'reference_not_public',
      resource: { resourceType: 'asset', readableId: 'chart', name: 'Private chart' },
    },
    {
      reason: 'reference_not_public',
      resource: { resourceType: 'page', readableId: 'related', name: 'Related page' },
    },
  ];
  await user.click(screen.getByRole('button', { name: 'Publish' }));
  let dialog = within(await screen.findByRole('dialog', { name: 'Publish page' }));
  const toggle = await dialog.findByRole('button', { name: '4 private resources' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(dialog.getByRole('alert').textContent).toBe(
    'Publish all resources referenced in this page before publishing it.',
  );
  expect(dialog.queryByRole('link')).toBeNull();
  expect(dialog.queryByRole('button', { name: 'Confirm with passkey' })).toBeNull();
  expect(dialog.queryByRole('button', { name: 'Review again' })).toBeNull();
  expect(dialog.queryByRole('button', { name: 'Cancel' })).toBeNull();
  expect(device.calls).toHaveLength(0);
  expect(state.comparisons).toHaveLength(0);
  toggle.focus();
  await user.keyboard('{Enter}');
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(dialog.getAllByRole('link')).toHaveLength(state.blockers.length);
  expect(dialog.getByRole('link', { name: 'Related page' }).getAttribute('href')).toStartWith(
    '/pages/related',
  );
  expect(dialog.getByRole('link', { name: 'Private source' }).getAttribute('href')).toStartWith(
    '/records/source',
  );
  expect(dialog.queryByText('Publish this referenced resource first.')).toBeNull();
  await user.click(toggle);
  expect(dialog.queryByRole('link')).toBeNull();
  await user.click(dialog.getByRole('button', { name: 'OK' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(state.begins).toHaveLength(1);
  state.blockers = state.blockers.slice(0, 1);
  await user.click(screen.getByRole('button', { name: 'Publish' }));
  dialog = within(await screen.findByRole('dialog', { name: 'Publish page' }));
  expect(await dialog.findByRole('button', { name: '1 private resource' })).toBeTruthy();
  await user.click(dialog.getByRole('button', { name: 'OK' }));
  state.blockers = [];
  await user.click(screen.getByRole('button', { name: 'Publish' }));
  dialog = within(await screen.findByRole('dialog', { name: 'Publish page' }));
  await dialog.findByText('Full content');
  await waitFor(() =>
    expect(
      dialog.getByRole('button', { name: 'Confirm with passkey' }).hasAttribute('disabled'),
    ).toBe(false),
  );
});

test('unavailable references and self-references retain specific guidance in a compact disclosure', async () => {
  const { state, user, device } = await renderPage();
  state.blockers = [
    {
      reason: 'reference_not_public',
      resource: { resourceType: 'page', readableId: 'notes', name: 'This page' },
    },
    {
      reason: 'reference_unavailable',
      resource: { resourceType: 'record', readableId: 'removed', name: 'Removed source' },
    },
  ];
  await user.click(screen.getByRole('button', { name: 'Publish' }));
  await screen.findByRole('button', { name: 'OK' });
  expect(screen.queryByRole('link', { name: 'Removed source' })).toBeNull();
  await user.click(screen.getByRole('button', { name: '2 references to fix' }));
  expect(screen.getByRole('link', { name: 'Removed source' }).getAttribute('href')).toStartWith(
    '/records/removed',
  );
  expect(screen.getByText(/Publish a revision without this self-reference/)).toBeTruthy();
  expect(screen.getByText(/Remove or replace this unavailable reference/)).toBeTruthy();
  expect(device.calls).toHaveLength(0);
  expect(state.comparisons).toHaveLength(0);
});

test('inbound public references explain both withdrawal and publishing a replacement revision', async () => {
  const { state, user } = await renderPage({ published: 1 });
  state.blockers = [
    {
      reason: 'public_page_reference',
      resource: { resourceType: 'page', readableId: 'referring', name: 'Referring page' },
    },
  ];
  await user.click(screen.getByRole('button', { name: 'Unpublish' }));
  expect(
    await screen.findByText(
      /Unpublish this referring page or publish a revision of it without this reference/,
    ),
  ).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Referring page' }).getAttribute('href')).toStartWith(
    '/pages/referring',
  );
});

test('saving a public page creates a private revision and exposes revision navigation after saving', async () => {
  const { state, user, page } = await renderPage({ published: 3 });
  await user.click(screen.getByRole('button', { name: 'Edit page' }));
  expect(screen.queryByText('Public revision 3')).toBeNull();
  expect(screen.getByText(/Saving creates a private revision/)).toBeTruthy();
  expect(screen.getByRole('textbox', { name: 'Interval (optional)' })).toBeTruthy();
  const editor = screen.getByRole('combobox', { name: 'Knowledge page content' });
  await user.clear(editor);
  await user.type(editor, '# New saved title\n\nPrivate changes');
  await user.click(screen.getByRole('button', { name: 'Save page' }));
  await screen.findByRole('button', { name: 'Unpublished revisions' });
  expect(page.revisionNumber).toBe(LATER_REVISION);
  expect(state.publication.publishedRevisionNumber).toBe(SELECTED_REVISION);
  expect(state.begins).toHaveLength(0);
});

test('archive refreshes stale public state and preserves the captured explanation through unknown status', async () => {
  const { state, user, client } = await renderPage();
  state.publication = {
    resourceType: 'page',
    publicId: 'page_handle',
    publishedAt: new Date().toISOString(),
    publishedRevisionNumber: 3,
  };
  await user.click(screen.getByRole('button', { name: 'Archive' }));
  await user.click(await screen.findByRole('button', { name: 'Archive page' }));
  await screen.findByRole('button', { name: 'Unpublish' });
  expect(screen.getByRole('alert').textContent).toBe(
    'Unpublish this resource before archiving it.',
  );
  await user.click(screen.getByRole('button', { name: 'Archive' }));
  expect(screen.getByText('Unpublish this page before archiving it.')).toBeTruthy();
  state.statusError = true;
  // biome-ignore lint/nursery/useAwaitThenable: React act intentionally returns a thenable.
  await act(async () => {
    await client.invalidateQueries(
      publicationStatusQueryOptions({ resourceType: 'page', readableId: 'notes' }),
    );
  });
  await screen.findByRole('button', { name: 'Retry publication status' });
  expect(screen.getByText('Unpublish this page before archiving it.')).toBeTruthy();
  expect(screen.queryByText('Private')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
});

test('page resource failure aborts a pending ceremony and late assertions cannot complete it', async () => {
  const { state, user, client, device } = await renderPage();
  const assertion = deferred<Credential>();
  device.pending = assertion.promise;
  await user.click(screen.getByRole('button', { name: 'Publish' }));
  await confirm(user);
  await screen.findByRole('button', { name: 'Waiting for passkey…' });
  state.pageError = true;
  await refreshPage(client);
  await screen.findByRole('heading', { name: 'Couldn’t load this page' });
  expect(device.calls[0]?.signal?.aborted).toBe(true);
  // biome-ignore lint/nursery/useAwaitThenable: React act intentionally returns a thenable.
  await act(async () => {
    assertion.resolve(device.response);
    await assertion.promise;
  });
  expect(state.completes).toHaveLength(0);
});
