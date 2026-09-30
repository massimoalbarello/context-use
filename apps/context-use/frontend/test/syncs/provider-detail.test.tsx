import { afterEach, expect, mock, test } from 'bun:test';
import '../support/dom';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ProviderDetail } from '../../src/components/syncs/provider-detail';
import { syncProviderSearch } from '../../src/routes/app.syncs.$providerId';
import { providerFixture } from './fixture';

afterEach(cleanup);
test('Authorization separates configured app status from account connection and remains restorable', async () => {
  const connect = mock(() => {});
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: '/app/syncs/$providerId',
    validateSearch: syncProviderSearch,
    component: Screen,
  });
  function Screen() {
    const [provider, setProvider] = useState(providerFixture);
    const { tab } = route.useSearch();
    const navigate = route.useNavigate();
    return (
      <ProviderDetail
        provider={provider}
        tab={tab}
        onTabChange={(tab) => {
          void navigate({ search: { tab } });
        }}
        pending={false}
        error={null}
        appError={null}
        authorizationFailed={false}
        onAction={() => {}}
        onConnect={connect}
        onSaveApp={() => {
          setProvider({
            ...provider,
            oauthApp: { ...provider.oauthApp, configured: true },
            syncs: provider.syncs.map((sync) => ({ ...sync, state: 'disconnected' })),
          });
          return Promise.resolve();
        }}
      />
    );
  }
  const history = createMemoryHistory({ initialEntries: ['/app/syncs/github?tab=authorization'] });
  const router = createRouter({ routeTree: root.addChildren([route]), history });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  const user = userEvent.setup({ document });
  expect(await view.findByRole('region', { name: 'OAuth app' })).toBeTruthy();
  expect(view.getByRole('region', { name: 'Account' })).toBeTruthy();
  expect(view.queryByRole('tab', { name: 'Account' })).toBeNull();
  expect(view.queryByRole('tab', { name: 'OAuth app' })).toBeNull();
  expect(view.queryByText('Records saved')).toBeNull();
  await user.click(view.getByRole('button', { name: 'Set up OAuth app' }));
  await user.click(view.getByRole('button', { name: 'I have an OAuth app' }));
  await user.type(view.getByLabelText('Client ID'), 'client');
  await user.type(view.getByLabelText('Client secret'), 'secret');
  await user.click(view.getByRole('button', { name: 'Save OAuth app' }));
  expect(await view.findByRole('button', { name: 'Edit OAuth app' })).toBeTruthy();
  expect(view.getByText('Configured')).toBeTruthy();
  expect(view.queryByLabelText('Client ID')).toBeNull();
  expect(view.queryByLabelText('Client secret')).toBeNull();
  expect(view.queryByLabelText('Authorization callback URL')).toBeNull();
  await user.click(view.getByRole('button', { name: 'Edit OAuth app' }));
  expect((view.getByLabelText('Client ID') as HTMLInputElement).value).toBe('');
  expect((view.getByLabelText('Client secret') as HTMLInputElement).value).toBe('');
  await user.type(view.getByLabelText('Client secret'), 'discarded-secret');
  await user.click(view.getByRole('button', { name: 'Cancel' }));
  expect(view.getByRole('button', { name: 'Edit OAuth app' })).toBeTruthy();
  expect(view.queryByLabelText('Client secret')).toBeNull();
  expect(view.container.innerHTML).not.toContain('discarded-secret');
  await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'authorization' }));
  expect(view.queryByText('Not connected')).toBeNull();
  await user.click(view.getByRole('button', { name: 'Connect account' }));
  expect(connect).toHaveBeenCalledTimes(1);
  await user.click(view.getByRole('tab', { name: 'Sync' }));
  expect(await view.findByRole('button', { name: 'Connect account' })).toBeTruthy();
  expect(view.queryByText('Waiting for account')).toBeNull();
  expect(view.queryByText('Records saved')).toBeNull();
  history.back();
  await waitFor(() =>
    expect(view.getByRole('tab', { name: 'Authorization' }).getAttribute('aria-selected')).toBe(
      'true',
    ),
  );
});

test('a connected account appears alongside the configured app', async () => {
  const provider = providerFixture();
  provider.oauthApp.configured = true;
  provider.account = { name: 'octocat', status: 'connected' };
  const props = {
    provider,
    tab: 'authorization' as const,
    onTabChange: () => {},
    pending: false,
    error: null,
    appError: null,
    authorizationFailed: false,
    onAction: () => {},
    onConnect: () => {},
    onSaveApp: () => Promise.resolve(),
  };
  const view = render(<ProviderDetail {...props} />);
  expect(view.queryByLabelText('Authorization callback URL')).toBeNull();
  expect(view.getByText('Configured')).toBeTruthy();
  expect(view.getByText('octocat')).toBeTruthy();
  const user = userEvent.setup({ document });
  await user.click(view.getByRole('button', { name: 'Edit OAuth app' }));
  expect(view.getByRole('button', { name: 'Save OAuth app' })).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Edit OAuth app' })).toBeNull();
  await user.click(view.getByRole('button', { name: 'Cancel' }));
  expect(view.getByText('octocat')).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Connect account' })).toBeNull();
  expect(view.queryByText('Not connected')).toBeNull();
});
