import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UnarchiveBlocker } from '#backend/models/resource-archiving/model.ts';
import { ArchivedResourceDetail } from '../../src/components/knowledge/archived-resource-detail';
import { ToastProvider } from '../../src/components/ui/toast';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanup();
  for (const dispose of cleanups.splice(0).reverse()) {
    dispose();
  }
});

function blocked(blockers: UnarchiveBlocker[]) {
  return Response.json({ error: 'Unarchive these resources first.', blockers }, { status: 409 });
}

async function renderUnarchive(respond: (request: Request) => Response | Promise<Response>) {
  const onUnarchived = mock(() => undefined);
  const resources = { pages: 'page', entities: 'entity', assets: 'asset' } as const;
  const root = createRootRoute({
    component: () => (
      <ToastProvider>
        <Outlet />
      </ToastProvider>
    ),
  });
  const detail = createRoute({
    getParentRoute: () => root,
    path: '/app/$collection/$id',
    component: () => {
      const { collection, id } = detail.useParams();
      return (
        <ArchivedResourceDetail
          resourceType={resources[collection as keyof typeof resources]}
          readableId={id}
          archivedAt={new Date('2026-01-01')}
          onUnarchived={onUnarchived}
        >
          <h1>{id}</h1>
        </ArchivedResourceDetail>
      );
    },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (...args: Parameters<typeof globalThis.fetch>) =>
        Promise.resolve(respond(new Request(...args))),
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  const router = createRouter({
    routeTree: root.addChildren([detail]),
    history: createMemoryHistory({ initialEntries: ['/app/pages/source'] }),
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
  return { router, onUnarchived, user: userEvent.setup() };
}

test('unarchive blockers appear only after an attempt in a dismissible dialog with fresh retry results', async () => {
  const response = Promise.withResolvers<Response>();
  let reply = response.promise;
  const { user, onUnarchived } = await renderUnarchive(() => reply);
  const trigger = screen.getByRole('button', { name: 'Unarchive' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText('Unarchive these resources first:')).toBeNull();

  await user.click(trigger);
  expect(screen.getByRole('button', { name: 'Unarchiving…' }).hasAttribute('disabled')).toBe(true);
  expect(screen.queryByRole('dialog')).toBeNull();
  response.resolve(
    blocked([
      { resourceType: 'entity', readableId: 'colleague', name: 'Recovery colleague' },
      { resourceType: 'page', readableId: 'requirements', name: 'Requirements' },
      { resourceType: 'asset', readableId: 'diagram', name: 'Recovery diagram' },
    ]),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Unarchive page' });
  expect(within(dialog).getByRole('alert').textContent).toBe('Unarchive these resources first:');
  expect(
    within(dialog).getByRole('link', { name: 'Recovery colleague' }).getAttribute('href'),
  ).toBe('/app/entities/colleague');
  expect(within(dialog).getByRole('link', { name: 'Requirements' }).getAttribute('href')).toContain(
    '/app/pages/requirements',
  );
  expect(within(dialog).getByRole('link', { name: 'Recovery diagram' }).getAttribute('href')).toBe(
    '/app/assets/diagram',
  );
  expect(onUnarchived).not.toHaveBeenCalled();

  await user.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(screen.queryByText('Unarchive these resources first:')).toBeNull();

  reply = Promise.resolve(
    blocked([{ resourceType: 'page', readableId: 'requirements', name: 'Requirements' }]),
  );
  await user.click(trigger);
  const retry = await screen.findByRole('dialog', { name: 'Unarchive page' });
  expect(within(retry).getByRole('link', { name: 'Requirements' })).toBeTruthy();
  expect(within(retry).queryByRole('link', { name: 'Recovery colleague' })).toBeNull();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

test('following a blocker opens its detail without carrying the previous resource dialog', async () => {
  const { user, router, onUnarchived } = await renderUnarchive(() =>
    blocked([{ resourceType: 'page', readableId: 'requirements', name: 'Requirements' }]),
  );
  await user.click(screen.getByRole('button', { name: 'Unarchive' }));
  const dialog = await screen.findByRole('dialog', { name: 'Unarchive page' });
  await user.click(within(dialog).getByRole('link', { name: 'Requirements' }));
  await screen.findByRole('heading', { name: 'requirements' });
  expect(router.state.location.pathname).toBe('/app/pages/requirements');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText('Unarchive these resources first:')).toBeNull();
  expect(screen.getByRole('button', { name: 'Unarchive' })).toBeTruthy();
  expect(onUnarchived).not.toHaveBeenCalled();
});

test('unarchive request errors use the same dismissible feedback dialog', async () => {
  const { user, onUnarchived } = await renderUnarchive(() =>
    Response.json({ error: 'Service temporarily unavailable' }, { status: 503 }),
  );
  await user.click(screen.getByRole('button', { name: 'Unarchive' }));
  const dialog = await screen.findByRole('dialog', { name: 'Unarchive page' });
  expect(within(dialog).getByRole('alert').textContent).toBe('Service temporarily unavailable');
  await user.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByText('Service temporarily unavailable')).toBeNull();
  expect(onUnarchived).not.toHaveBeenCalled();
});
