import { afterEach, expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecordDetail } from '../../src/components/records/record-detail';
import type {
  PublicationBlocker,
  PublicationReady,
  PublicationRequest,
} from '../../src/queries/publications';
import { recordsListQueryKey } from '../../src/queries/records';
import { authenticator } from './passkey-device';

const APPROVAL_LIFETIME_MS = 120_000;
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanup();
  for (const dispose of cleanups.splice(0).reverse()) {
    dispose();
  }
});

async function renderRecord({ statusError = false }: { statusError?: boolean } = {}) {
  const device = authenticator(cleanups);
  const timestamp = new Date('2026-01-01').toISOString();
  const state = {
    publication: {
      publicId: null,
      publishedAt: null,
    } as PublicationReady['preparation']['publication'],
    statusError,
    blockers: [] as PublicationBlocker[],
    begins: [] as PublicationRequest[],
  };
  async function begin(request: Request) {
    state.begins.push(await request.json());
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
        resource: { resourceType: 'record', readableId: 'meeting', name: 'Meeting notes' },
        publication: { ...state.publication },
        includedImage: null,
        entityIdentity: null,
        pageRevision: null,
        blockers: [],
      },
    };
    return Response.json(ready);
  }
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (...args: Parameters<typeof globalThis.fetch>) => {
        const request = new Request(...args);
        const path = new URL(request.url).pathname;
        if (path === '/api/records/meeting') {
          return Response.json({
            readableId: 'meeting',
            title: 'Meeting notes',
            source: { provider: 'calendar', kind: 'meeting', id: 'source', url: null },
            sourceCreatedAt: null,
            sourceUpdatedAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
            body: 'Source evidence.',
            backlinks: [],
          });
        }
        if (path === '/api/publications/record/meeting') {
          return state.statusError
            ? Response.json({ error: 'Status unavailable' }, { status: 503 })
            : Response.json({ resourceType: 'record', ...state.publication });
        }
        if (path === '/api/publications/approvals') {
          return await begin(request);
        }
        if (path.endsWith('/complete')) {
          state.publication = {
            publicId: 'record_public-handle',
            publishedAt: state.begins.at(-1)?.action === 'publish' ? timestamp : null,
          };
          return Response.json({ state: 'changed', publication: state.publication });
        }
        throw new Error(`Unexpected request: ${path}`);
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(recordsListQueryKey, []);
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <RecordDetail id="meeting" onViewChange={() => undefined} />,
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
  await screen.findByRole('button', { name: statusError ? 'Retry publication status' : 'Publish' });
  return { state, device, client, user: userEvent.setup() };
}

test('records disclose live sync updates and use fresh passkey approval for publishing and withdrawal', async () => {
  const { state, device, client, user } = await renderRecord();
  await user.click(screen.getByRole('button', { name: 'Publish' }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Publish record' }));
  expect(await dialog.findByText('Meeting notes')).toBeTruthy();
  expect(dialog.getByText(/Future sync updates will also be public/)).toBeTruthy();
  await user.click(dialog.getByRole('button', { name: 'Confirm with passkey' }));
  await screen.findByRole('button', { name: 'Unpublish' });
  expect(screen.getByRole('link', { name: 'View public' }).getAttribute('href')).toBe(
    '/public/records/record_public-handle',
  );
  expect(client.getQueryState(recordsListQueryKey)?.isInvalidated).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Unpublish' }));
  expect(
    await screen.findByText(/Referenced assets keep their own publication state/),
  ).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Confirm with passkey' }));
  await screen.findByRole('button', { name: 'Publish' });
  expect(screen.queryByRole('link', { name: 'View public' })).toBeNull();
  expect(state.begins).toEqual([
    { resourceType: 'record', readableId: 'meeting', action: 'publish' },
    { resourceType: 'record', readableId: 'meeting', action: 'unpublish' },
  ]);
  expect(device.calls).toHaveLength(2);
});

test('unknown record publication status must recover before preparing publication', async () => {
  const { state, user } = await renderRecord({ statusError: true });
  expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  expect(screen.queryByText('Private')).toBeNull();
  state.statusError = false;
  await user.click(screen.getByRole('button', { name: 'Retry publication status' }));
  await screen.findByRole('button', { name: 'Publish' });
  expect(screen.getByText('Private')).toBeTruthy();
});

test('private record attachments block confirmation and expose an actionable asset link', async () => {
  const { state, device, user } = await renderRecord();
  state.blockers = [
    {
      reason: 'reference_not_public',
      resource: { resourceType: 'asset', readableId: 'attachment', name: 'Private attachment' },
    },
  ];
  await user.click(screen.getByRole('button', { name: 'Publish' }));
  const link = await screen.findByRole('link', { name: 'Private attachment' });
  expect(link.getAttribute('href')).toStartWith('/app/assets/attachment');
  expect(screen.queryByRole('button', { name: 'Confirm with passkey' })).toBeNull();
  expect(device.calls).toHaveLength(0);
});
