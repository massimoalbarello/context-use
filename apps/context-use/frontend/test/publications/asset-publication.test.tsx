import { afterEach, expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssetDetail } from '../../src/components/assets/asset-detail';
import type { Asset } from '../../src/queries/assets';
import {
  assetQueryOptions,
  assetSuggestionsQueryKey,
  assetsListQueryKey,
} from '../../src/queries/assets';
import { knowledgeSuggestionsQueryKey } from '../../src/queries/knowledge-suggestions';
import {
  type CompletePublicationVariables,
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

async function renderAsset({ statusError = false }: { statusError?: boolean } = {}) {
  const device = authenticator(cleanups);
  const timestamp = new Date('2026-01-01');
  const asset: Asset = {
    readableId: 'chart',
    name: 'Launch chart',
    mediaType: 'application/octet-stream',
    extension: 'bin',
    sizeBytes: 1024,
    createdAt: timestamp,
    updatedAt: timestamp,
    usages: [],
    depicts: [],
  };
  const state = {
    publication: {
      publicId: null,
      publishedAt: null,
    } as PublicationReady['preparation']['publication'],
    statusError,
    assetError: false,
    beginError: undefined as Response | undefined,
    completeError: undefined as Response | undefined,
    lostResponse: false,
    expiresAt: undefined as string | undefined,
    begins: [] as PublicationRequest[],
    ready: [] as PublicationReady[],
    completes: [] as CompletePublicationVariables[],
    statusReads: 0,
  };
  async function begin(request: Request) {
    state.begins.push(await request.json());
    if (state.beginError) {
      return state.beginError.clone();
    }
    const ready: PublicationReady = {
      state: 'ready',
      approvalId: `approval-${state.begins.length}`,
      expiresAt: state.expiresAt ?? new Date(Date.now() + APPROVAL_LIFETIME_MS).toISOString(),
      options: {
        challenge: state.begins.length === 1 ? 'AQ' : 'Ag',
        rpId: 'localhost',
        userVerification: 'required',
      },
      preparation: {
        resource: { resourceType: 'asset', readableId: 'chart', name: asset.name },
        publication: { ...state.publication },
        includedImage: null,
        entityIdentity: null,
        pageRevision: null,
        blockers: [],
      },
    };
    state.ready.push(ready);
    return Response.json(ready);
  }
  async function complete(request: Request) {
    const path = new URL(request.url).pathname;
    const body: Pick<CompletePublicationVariables, 'assertion'> = await request.json();
    state.completes.push({ approvalId: path.split('/').at(-2)!, ...body });
    if (state.completeError) {
      return state.completeError.clone();
    }
    state.publication = {
      publicId: 'asset_public-handle',
      publishedAt: state.begins.at(-1)?.action === 'publish' ? timestamp.toISOString() : null,
    };
    if (state.lostResponse) {
      throw new TypeError('Connection lost');
    }
    return Response.json({ state: 'changed', publication: state.publication });
  }
  function status() {
    state.statusReads++;
    return state.statusError
      ? Response.json({ error: 'Status unavailable' }, { status: 503 })
      : Response.json({ resourceType: 'asset', ...state.publication });
  }
  function archive() {
    return state.publication.publishedAt
      ? Response.json({ error: 'Unpublish this resource before archiving it.' }, { status: 409 })
      : new Response(null, { status: 204 });
  }
  async function detail(request: Request) {
    if (state.assetError) {
      return Response.json({ error: 'Asset temporarily unavailable' }, { status: 503 });
    }
    if (request.method === 'PUT') {
      Object.assign(asset, await request.json());
    }
    return Response.json(asset);
  }
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (...args: Parameters<typeof globalThis.fetch>) => {
        const request = new Request(...args);
        const path = new URL(request.url).pathname;
        if (path === '/api/assets/chart') {
          return await detail(request);
        }
        if (path === '/api/assets/chart/archive') {
          return archive();
        }
        if (path === '/api/publications/asset/chart') {
          return status();
        }
        if (path === '/api/publications/approvals') {
          return begin(request);
        }
        if (path.endsWith('/complete')) {
          return complete(request);
        }
        throw new Error(`Unexpected request: ${request.method} ${path}`);
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  for (const key of [assetsListQueryKey, assetSuggestionsQueryKey, knowledgeSuggestionsQueryKey]) {
    client.setQueryData(key, []);
  }
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <AssetDetail id="chart" onArchived={() => undefined} />,
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  cleanups.push(
    () => client.clear(),
    () => fetch.mockRestore(),
  );
  await screen.findByRole('button', { name: statusError ? 'Retry publication status' : 'Publish' });
  return { state, asset, device, client, view, user: userEvent.setup() };
}

async function confirmReview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Confirm with passkey' }));
}

test('asset is reviewed, published, and withdrawn with a retained handle and fresh confirmation each time', async () => {
  const { state, user, device, client } = await renderAsset();
  await user.click(screen.getByRole('button', { name: 'Publish' }));
  const dialog = await screen.findByRole('dialog', { name: 'Publish asset' });
  expect(within(dialog).getByText('Launch chart')).toBeTruthy();
  expect(within(dialog).getByText(/original file/)).toBeTruthy();
  await confirmReview(user);
  await screen.findByRole('button', { name: 'Unpublish' });
  expect(screen.getByText('Public')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'View public' }).getAttribute('href')).toBe(
    '/public/assets/asset_public-handle',
  );
  expect(state.begins).toEqual([{ resourceType: 'asset', readableId: 'chart', action: 'publish' }]);
  expect(new Uint8Array(device.calls[0]!.publicKey!.challenge as ArrayBuffer)).toEqual(
    new Uint8Array([1]),
  );
  expect(state.completes[0]?.approvalId).toBe(state.ready[0]?.approvalId);
  for (const key of [assetsListQueryKey, assetSuggestionsQueryKey, knowledgeSuggestionsQueryKey]) {
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  }
  await user.click(screen.getByRole('button', { name: 'Archive' }));
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Unpublish this asset before archiving it.',
  );
  await user.click(screen.getByRole('button', { name: 'Unpublish' }));
  expect(await screen.findByText(/Copies already downloaded/)).toBeTruthy();
  await confirmReview(user);
  await screen.findByRole('button', { name: 'Publish' });
  expect(screen.getByText('Private')).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'View public' })).toBeNull();
  expect(state.publication.publicId).toBe('asset_public-handle');
  expect(device.calls).toHaveLength(2);
});

test('public dependencies provide private resource links without starting a passkey ceremony', async () => {
  const { state, user, device } = await renderAsset();
  await user.click(screen.getByRole('button', { name: 'Publish' }));
  await confirmReview(user);
  await screen.findByRole('button', { name: 'Unpublish' });
  state.beginError = Response.json(
    {
      state: 'blocked',
      error: 'Resolve publication dependencies.',
      blockers: [
        {
          reason: 'public_page_reference',
          resource: { resourceType: 'page', readableId: 'launch', name: 'Launch page' },
        },
        {
          reason: 'public_entity_image',
          resource: { resourceType: 'entity', readableId: 'alex', name: 'Alex' },
        },
      ],
    },
    { status: 409 },
  );
  await user.click(screen.getByRole('button', { name: 'Unpublish' }));
  const link = await screen.findByRole('link', { name: 'Launch page' });
  expect(link.getAttribute('href')).toStartWith('/app/pages/launch');
  expect(screen.getByRole('link', { name: 'Alex' }).getAttribute('href')).toStartWith(
    '/app/entities/alex',
  );
  expect(screen.queryByRole('button', { name: 'Confirm with passkey' })).toBeNull();
  expect(device.calls).toHaveLength(1);
  expect(state.completes).toHaveLength(1);
});

test('stale review requires an explicit new review and uses its new challenge only after renewed consent', async () => {
  const { state, asset, client, user, device } = await renderAsset();
  state.completeError = Response.json(
    { state: 'state_changed', error: 'The reviewed resource changed. Review again.' },
    { status: 409 },
  );
  await user.click(screen.getByRole('button', { name: 'Publish' }));
  const dialog = await screen.findByRole('dialog', { name: 'Publish asset' });
  asset.name = 'Updated launch chart';
  // biome-ignore lint/nursery/useAwaitThenable: React act intentionally returns a thenable.
  await act(async () => {
    await client.invalidateQueries(assetQueryOptions('chart'));
  });
  expect(await screen.findByText('Updated launch chart')).toBeTruthy();
  expect(within(dialog).getByText('Launch chart')).toBeTruthy();
  await confirmReview(user);
  await screen.findByRole('button', { name: 'Review again' });
  expect(state.begins).toHaveLength(1);
  expect(state.completes).toHaveLength(1);
  state.completeError = undefined;
  await user.click(screen.getByRole('button', { name: 'Review again' }));
  await screen.findByRole('button', { name: 'Confirm with passkey' });
  expect(within(dialog).getByText('Updated launch chart')).toBeTruthy();
  expect(device.calls).toHaveLength(1);
  await confirmReview(user);
  await screen.findByRole('button', { name: 'Unpublish' });
  expect(new Uint8Array(device.calls[1]!.publicKey!.challenge as ArrayBuffer)).toEqual(
    new Uint8Array([2]),
  );
  expect(state.completes[1]?.approvalId).toBe(state.ready[1]?.approvalId);
});

test('an expired preparation cannot start verification until it is reviewed again', async () => {
  const { state, user, device } = await renderAsset();
  state.expiresAt = new Date(0).toISOString();
  await user.click(screen.getByRole('button', { name: 'Publish' }));
  await screen.findByText(/This review has expired/);
  expect(screen.queryByRole('button', { name: 'Confirm with passkey' })).toBeNull();
  expect(device.calls).toHaveLength(0);
  state.expiresAt = undefined;
  await user.click(screen.getByRole('button', { name: 'Review again' }));
  await confirmReview(user);
  await screen.findByRole('button', { name: 'Unpublish' });
  expect(device.calls).toHaveLength(1);
});

for (const close of ['cancel', 'unmount', 'resource error'] as const) {
  test(`${close} aborts an owned deferred ceremony and never completes after its late assertion`, async () => {
    const { state, client, user, device, view } = await renderAsset();
    const assertion = deferred<Credential>();
    device.pending = assertion.promise;
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await confirmReview(user);
    const pending = await screen.findByRole('button', { name: 'Waiting for passkey…' });
    expect(pending.hasAttribute('disabled')).toBe(true);
    await user.click(pending);
    expect(device.calls).toHaveLength(1);
    if (close === 'cancel') {
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
    } else if (close === 'unmount') {
      view.unmount();
    } else {
      state.assetError = true;
      await client.invalidateQueries(assetQueryOptions('chart'));
      await screen.findByRole('heading', { name: 'Couldn’t load this asset' });
    }
    expect(device.calls[0]?.signal?.aborted).toBe(true);
    // biome-ignore lint/nursery/useAwaitThenable: React act intentionally returns a thenable.
    await act(async () => {
      assertion.resolve(device.response);
      await assertion.promise;
    });
    expect(state.completes).toHaveLength(0);
  });
}

test('lost completion response refreshes actual public status without retrying the write', async () => {
  const { state, user } = await renderAsset();
  state.lostResponse = true;
  await user.click(screen.getByRole('button', { name: 'Publish' }));
  await confirmReview(user);
  await screen.findByRole('button', { name: 'Review again' });
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await screen.findByRole('button', { name: 'Unpublish' });
  expect(screen.getByText('Public')).toBeTruthy();
  expect(state.statusReads).toBe(2);
  expect(state.completes).toHaveLength(1);
});

test('a failed status refresh stays unknown and preserves the captured publication archive explanation', async () => {
  const { state, user, client } = await renderAsset();
  await user.click(screen.getByRole('button', { name: 'Publish' }));
  await confirmReview(user);
  await user.click(await screen.findByRole('button', { name: 'Archive' }));
  state.statusError = true;
  // biome-ignore lint/nursery/useAwaitThenable: React act intentionally returns a thenable.
  await act(
    async () =>
      await client.invalidateQueries(
        publicationStatusQueryOptions({ resourceType: 'asset', readableId: 'chart' }),
      ),
  );
  await screen.findByRole('button', { name: 'Retry publication status' });
  expect(screen.queryByText('Private')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Unpublish' })).toBeNull();
  expect(screen.getByRole('alert').textContent).toBe('Unpublish this asset before archiving it.');
  state.statusError = false;
  await user.click(screen.getByRole('button', { name: 'Retry publication status' }));
  await screen.findByRole('button', { name: 'Unpublish' });
});

test('initial status failure is unknown until an explicit retry succeeds', async () => {
  const { state, user } = await renderAsset({ statusError: true });
  expect(screen.queryByText('Private')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  state.statusError = false;
  await user.click(screen.getByRole('button', { name: 'Retry publication status' }));
  await screen.findByRole('button', { name: 'Publish' });
  expect(screen.getByText('Private')).toBeTruthy();
});

test('an archive rejected by newly published server state explains withdrawal and refreshes status', async () => {
  const { state, user } = await renderAsset();
  state.publication = { publicId: 'asset_public-handle', publishedAt: new Date().toISOString() };
  await user.click(screen.getByRole('button', { name: 'Archive' }));
  await user.click(await screen.findByRole('button', { name: 'Archive asset' }));
  await screen.findByRole('button', { name: 'Unpublish' });
  expect(screen.getByRole('alert').textContent).toBe(
    'Unpublish this resource before archiving it.',
  );
  expect(state.statusReads).toBe(2);
});
