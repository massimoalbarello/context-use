import { afterEach, expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EntityDetail } from '../../src/components/entities/entity-detail';
import type { AssetSummary } from '../../src/queries/assets';
import {
  assetSuggestionsQueryKey,
  assetsListQueryKey,
  imageAssetSuggestionsQueryOptions,
} from '../../src/queries/assets';
import { type EntityDetail as Entity, entityQueryOptions } from '../../src/queries/entities';
import {
  type PublicationReady,
  type PublicationRequest,
  publicationStatusQueryOptions,
} from '../../src/queries/publications';
import { authenticator, deferred } from './passkey-device';

const APPROVAL_LIFETIME_MS = 120_000;
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanup();
  for (const dispose of cleanups.splice(0).reverse()) {
    dispose();
  }
});

async function renderEntity({ isPublic = false, statusError = false } = {}) {
  const timestamp = new Date('2026-01-01');
  const asset = (readableId: string): AssetSummary => ({
    readableId,
    name: readableId,
    mediaType: 'image/png',
    extension: 'png',
    sizeBytes: 100,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const entity: Entity = {
    readableId: 'studio',
    name: 'Cached studio',
    description: 'Cached description',
    entityType: 'organization',
    isSelf: false,
    image: asset('cached-portrait'),
    createdAt: timestamp,
    updatedAt: timestamp,
    pages: [],
  };
  const state = {
    publication: {
      publicId: isPublic ? 'entity_handle' : null,
      publishedAt: isPublic ? timestamp.toISOString() : null,
    } as PublicationReady['preparation']['publication'],
    statusError,
    entityError: false,
    preparedName: 'Prepared studio',
    preparedDescription: 'Prepared description',
    image: asset('prepared-portrait') as AssetSummary | null,
    begins: [] as PublicationRequest[],
    completes: [] as string[],
    requests: [] as URL[],
    assigned: [] as string[],
  };
  const device = authenticator(cleanups);
  async function begin(request: Request) {
    const body: PublicationRequest = await request.json();
    state.begins.push(body);
    const ready: PublicationReady = {
      state: 'ready',
      approvalId: `approval-${state.begins.length}`,
      expiresAt: new Date(Date.now() + APPROVAL_LIFETIME_MS).toISOString(),
      options: { challenge: 'AQ', rpId: 'localhost', userVerification: 'required' },
      preparation: {
        resource: { resourceType: 'entity', readableId: 'studio', name: state.preparedName },
        publication: { ...state.publication },
        entityIdentity: { description: state.preparedDescription, entityType: 'location' },
        includedImage:
          body.action === 'publish' && state.image
            ? {
                resource: {
                  resourceType: 'asset',
                  readableId: state.image.readableId,
                  name: state.image.name,
                },
                publication: { publicId: null, publishedAt: null },
              }
            : null,
        pageRevision: null,
        blockers: [],
      },
    };
    return Response.json(ready);
  }
  function complete(url: URL) {
    state.completes.push(url.pathname.split('/').at(-2)!);
    state.publication = {
      publicId: 'entity_handle',
      publishedAt: state.begins.at(-1)?.action === 'publish' ? timestamp.toISOString() : null,
    };
    return Response.json({ state: 'changed', publication: state.publication });
  }
  function suggestions(url: URL) {
    const items =
      url.searchParams.get('visibility') === 'public'
        ? [asset('public-landscape')]
        : [asset('private-landscape'), asset('public-landscape')];
    return url.pathname === '/api/assets'
      ? Response.json({ items, total: items.length, nextOffset: null })
      : Response.json({
          results: items.map((asset) => ({
            resourceType: 'asset',
            address: `context-use://asset/${asset.readableId}`,
            asset,
            matchExcerpt: null,
          })),
          totalMatches: items.length,
          truncated: false,
        });
  }
  const handlers: Record<string, (request: Request) => Response | Promise<Response>> = {
    '/api/entities/studio': () =>
      state.entityError
        ? Response.json({ error: 'Entity unavailable' }, { status: 503 })
        : Response.json(entity),
    '/api/entities/studio/image': async (request) => {
      const body = await request.json();
      state.assigned.push(body.assetReadableId);
      entity.image = asset(body.assetReadableId);
      return new Response(null, { status: 204 });
    },
    '/api/publications/entity/studio': () =>
      state.statusError
        ? Response.json({ error: 'Unavailable' }, { status: 503 })
        : Response.json({ resourceType: 'entity', ...state.publication }),
    '/api/publications/asset/prepared-portrait': () =>
      Response.json({ resourceType: 'asset', publicId: null, publishedAt: null }),
    '/api/publications/approvals': begin,
    '/api/entities/studio/archive': () =>
      state.publication.publishedAt
        ? Response.json({ error: 'Unpublish this resource before archiving it.' }, { status: 409 })
        : new Response(null, { status: 204 }),
    '/api/assets': (request) => suggestions(new URL(request.url)),
    '/api/hypermedia/search': (request) => suggestions(new URL(request.url)),
  };
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (...args: Parameters<typeof globalThis.fetch>) => {
        const request = new Request(...args);
        const url = new URL(request.url);
        state.requests.push(url);
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
  for (const key of [assetSuggestionsQueryKey, assetsListQueryKey]) {
    client.setQueryData(key, []);
  }
  client.setQueryData(
    publicationStatusQueryOptions({ resourceType: 'asset', readableId: 'prepared-portrait' })
      .queryKey,
    { resourceType: 'asset', publicId: null, publishedAt: null },
  );
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <EntityDetail id="studio" onArchived={() => undefined} />,
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
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
    name: statusError ? 'Retry publication status' : isPublic ? 'Unpublish' : 'Publish',
  });
  return { state, client, device, entity, user: userEvent.setup() };
}

async function refresh(client: QueryClient) {
  // biome-ignore lint/nursery/useAwaitThenable: React act intentionally returns a thenable.
  await act(async () => {
    await client.invalidateQueries(
      publicationStatusQueryOptions({ resourceType: 'entity', readableId: 'studio' }),
    );
  });
}

test('entity review keeps its prepared name and refreshes entity and image publication state', async () => {
  const { state, user, client, entity, device } = await renderEntity();
  expect(
    screen
      .getByRole('button', { name: 'Publish' })
      .compareDocumentPosition(screen.getByRole('button', { name: 'Edit entity' })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Publish' }));
  const dialog = await screen.findByRole('dialog', { name: 'Publish entity' });
  expect(within(dialog).getByText('Prepared studio')).toBeTruthy();
  expect(
    within(dialog).getByText(
      'Anyone with the public link can view this entity and its public page index.',
    ),
  ).toBeTruthy();
  expect(within(dialog).queryByText('Cached studio')).toBeNull();
  expect(within(dialog).queryByText('Prepared description')).toBeNull();
  expect(within(dialog).queryByText(/entire image asset/)).toBeNull();
  entity.name = 'New live identity';
  entity.description = 'New live description';
  // biome-ignore lint/nursery/useAwaitThenable: React act intentionally returns a thenable.
  await act(async () => {
    await client.invalidateQueries(entityQueryOptions('studio'));
  });
  expect(within(dialog).getByText('Prepared studio')).toBeTruthy();
  expect(within(dialog).queryByText('New live identity')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Confirm with passkey' }));
  await screen.findByRole('button', { name: 'Unpublish' });
  expect(
    screen
      .getByRole('button', { name: 'Unpublish' })
      .compareDocumentPosition(screen.getByRole('button', { name: 'Edit entity' })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.getByRole('link', { name: 'View public' }).getAttribute('href')).toBe(
    '/public/entities/entity_handle',
  );
  for (const key of [
    assetSuggestionsQueryKey,
    assetsListQueryKey,
    publicationStatusQueryOptions({ resourceType: 'asset', readableId: 'prepared-portrait' })
      .queryKey,
  ]) {
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  }
  await user.click(screen.getByRole('button', { name: 'Unpublish' }));
  expect(await screen.findByText(/does not unpublish its image assets/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Confirm with passkey' }));
  await screen.findByRole('button', { name: 'Publish' });
  expect(screen.getByText('Private')).toBeTruthy();
  expect(state.begins.map((request) => request.action)).toEqual(['publish', 'unpublish']);
  expect(state.completes).toEqual(['approval-1', 'approval-2']);
  expect(device.calls).toHaveLength(2);
});

test('public image picker requests public list and keyword results while preserving the identity draft', async () => {
  const { user, state, client } = await renderEntity({ isPublic: true });
  await client.fetchQuery(imageAssetSuggestionsQueryOptions({ query: '' }));
  await user.click(screen.getByRole('button', { name: 'Edit entity' }));
  expect(
    screen.getByText(/Saved changes to its name, description, and type appear publicly/),
  ).toBeTruthy();
  await user.clear(screen.getByRole('textbox', { name: 'Name' }));
  await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Unsaved studio');
  await user.click(screen.getByRole('button', { name: 'Edit entity image' }));
  await screen.findByRole('button', { name: /public-landscape/ });
  expect(screen.queryByRole('button', { name: /private-landscape/ })).toBeNull();
  expect(screen.queryByRole('tab', { name: 'Upload new' })).toBeNull();
  const guidance = screen.getByRole('link', { name: 'Assets (opens in a new tab)' });
  expect(guidance.getAttribute('href')).toBe('/app/assets');
  expect(guidance.getAttribute('target')).toBe('_blank');
  await user.type(screen.getByRole('textbox', { name: 'Search image assets' }), 'landscape');
  await waitFor(() =>
    expect(
      state.requests.some(
        (url) =>
          url.pathname === '/api/hypermedia/search' &&
          url.searchParams.get('query') === 'landscape' &&
          url.searchParams.get('visibility') === 'public' &&
          url.searchParams.get('assetKind') === 'entity_image',
      ),
    ).toBe(true),
  );
  expect(screen.queryByRole('button', { name: /private-landscape/ })).toBeNull();
  await user.click(await screen.findByRole('button', { name: /public-landscape/ }));
  await waitFor(() => expect(state.assigned).toEqual(['public-landscape']));
  expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe(
    'Unsaved studio',
  );
  expect(
    state.requests.some(
      (url) =>
        url.pathname === '/api/assets' &&
        url.searchParams.get('visibility') === 'public' &&
        url.searchParams.get('kind') === 'entity_image',
    ),
  ).toBe(true);
  state.statusError = true;
  await refresh(client);
  await screen.findByRole('button', { name: 'Retry publication status' });
  expect(screen.queryByRole('tab', { name: 'Upload new' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Search image assets' })).toBeNull();
  expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe(
    'Unsaved studio',
  );
  state.statusError = false;
  await user.click(screen.getByRole('button', { name: 'Retry publication status' }));
  await screen.findByRole('button', { name: /public-landscape/ });
  expect(screen.queryByRole('tab', { name: 'Upload new' })).toBeNull();
});

test('unknown publication status gates image upload and retries without losing the identity draft', async () => {
  const { state, user } = await renderEntity({ statusError: true });
  expect(screen.queryByText('Private')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Edit entity' }));
  await user.type(screen.getByRole('textbox', { name: 'Name' }), ' draft');
  await user.click(screen.getByRole('button', { name: 'Edit entity image' }));
  expect(
    await screen.findByText('Resolve publication status before choosing an image.'),
  ).toBeTruthy();
  expect(screen.queryByRole('tab', { name: 'Upload new' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Search image assets' })).toBeNull();
  state.statusError = false;
  await user.click(screen.getByRole('button', { name: 'Retry publication status' }));
  expect(await screen.findByRole('tab', { name: 'Upload new' })).toBeTruthy();
  expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe(
    'Cached studio draft',
  );
});

test('archive keeps the public explanation through a status error and stale server state refreshes status', async () => {
  const { state, user, client } = await renderEntity();
  state.publication = { publicId: 'entity_handle', publishedAt: new Date().toISOString() };
  await user.click(screen.getByRole('button', { name: 'Archive' }));
  await user.click(await screen.findByRole('button', { name: 'Archive entity' }));
  await screen.findByRole('button', { name: 'Unpublish' });
  expect(screen.getByRole('alert').textContent).toBe(
    'Unpublish this resource before archiving it.',
  );
  await user.click(screen.getByRole('button', { name: 'Archive' }));
  expect(screen.getByText('Unpublish this entity before archiving it.')).toBeTruthy();
  state.statusError = true;
  await refresh(client);
  await screen.findByRole('button', { name: 'Retry publication status' });
  expect(screen.getByText('Unpublish this entity before archiving it.')).toBeTruthy();
  expect(screen.queryByText('Private')).toBeNull();
});

test('entity resource failure aborts a deferred approval and cannot complete after a late assertion', async () => {
  const { state, user, client, device } = await renderEntity();
  const assertion = deferred<Credential>();
  device.pending = assertion.promise;
  await user.click(screen.getByRole('button', { name: 'Publish' }));
  await user.click(await screen.findByRole('button', { name: 'Confirm with passkey' }));
  await screen.findByRole('button', { name: 'Waiting for passkey…' });
  state.entityError = true;
  await client.invalidateQueries(entityQueryOptions('studio'));
  await screen.findByRole('heading', { name: 'Couldn’t load this entity' });
  expect(device.calls[0]?.signal?.aborted).toBe(true);
  // biome-ignore lint/nursery/useAwaitThenable: React act intentionally returns a thenable.
  await act(async () => {
    assertion.resolve(device.response);
    await assertion.promise;
  });
  expect(state.completes).toHaveLength(0);
});
