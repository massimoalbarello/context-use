import { afterEach, expect, mock, test } from 'bun:test';
import '../support/dom';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManagedSyncCard } from '../../src/components/syncs/managed-sync-card';
import { providerFixture } from './fixture';

afterEach(cleanup);
test('sync controls use registered provider, kind, and schedule metadata', async () => {
  const sync = {
    ...providerFixture().syncs[0]!,
    provider: 'calendar',
    kinds: ['event'],
    state: 'ready' as const,
    intervalMs: 300_000,
  };
  const action = mock(() => {});
  const root = createRootRoute({
    component: () => <ManagedSyncCard sync={sync} pending={false} onAction={action} />,
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  expect(await view.findByText('Up to date')).toBeTruthy();
  expect(view.getByText('Every 5 minutes')).toBeTruthy();
  expect(view.getByRole('link', { name: 'View records' }).getAttribute('href')).toContain(
    'provider=calendar',
  );
  expect(view.getByRole('link', { name: 'View records' }).getAttribute('href')).toContain(
    'kind=event',
  );
  await userEvent.setup({ document }).click(view.getByRole('button', { name: 'Pause' }));
  expect(action).toHaveBeenCalledWith('pause');
});

test('paused syncs explain why they stopped and offer Resume without a disabled Sync now action', async () => {
  const sync = {
    ...providerFixture().syncs[0]!,
    state: 'paused' as const,
    message: 'Syncing paused after a provider error. Check your account access before resuming.',
  };
  const action = mock(() => {});
  const root = createRootRoute({
    component: () => <ManagedSyncCard sync={sync} pending={false} onAction={action} />,
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  expect((await view.findByRole('status')).textContent).toBe(sync.message);
  expect(view.queryByRole('button', { name: 'Sync now' })).toBeNull();
  await userEvent.setup({ document }).click(view.getByRole('button', { name: 'Resume' }));
  expect(action).toHaveBeenCalledWith('resume');
});
