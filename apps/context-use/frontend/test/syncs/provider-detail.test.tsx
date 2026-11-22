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
        onReauthorize={() => {}}
        onSaveApiKey={() => Promise.resolve()}
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

test.each(['connected', 'error'] as const)(
  'an existing %s account can be reauthorized',
  async (status) => {
    const provider = providerFixture();
    provider.oauthApp.configured = true;
    provider.account = { name: 'octocat', status };
    provider.syncs[0]!.state = 'paused';
    const reauthorize = mock(() => {});
    const props = {
      provider,
      tab: 'authorization' as const,
      onTabChange: () => {},
      pending: false,
      error: null,
      appError: null,
      authorizationFailed: false,
      onAction: () => {},
      onSaveApiKey: () => Promise.resolve(),
      onConnect: () => {},
      onReauthorize: reauthorize,
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
    await user.click(view.getByRole('button', { name: 'Reauthorize account' }));
    expect(reauthorize).toHaveBeenCalledTimes(1);
    view.rerender(<ProviderDetail {...props} pending />);
    expect(
      (view.getByRole('button', { name: 'Reauthorize account' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(view.getByRole('button', { name: 'Reauthorize account' }));
    expect(reauthorize).toHaveBeenCalledTimes(1);
    view.rerender(<ProviderDetail {...props} error={new Error('Authorization unavailable')} />);
    expect(view.getByText('Authorization unavailable')).toBeTruthy();
    expect(
      (view.getByRole('button', { name: 'Reauthorize account' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    provider.syncs[0]!.state = 'disconnected';
    view.rerender(<ProviderDetail {...props} />);
    expect(view.getByRole('button', { name: 'Start sync' })).toBeTruthy();
    expect(view.getByRole('button', { name: 'Reauthorize account' })).toBeTruthy();
  },
);

test('Granola uses an API key form and clears submitted keys on success and failure', async () => {
  const provider = {
    ...providerFixture(),
    id: 'granola',
    name: 'Granola',
    oauthApp: null,
    apiKeySetupUrl: 'https://docs.granola.ai/help-center/sharing/integrations/granola-api',
  };
  const save = mock(() => Promise.resolve());
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
    onReauthorize: () => {},
    onSaveApiKey: save,
    onSaveApp: () => Promise.resolve(),
  };
  const view = render(<ProviderDetail {...props} />);
  const user = userEvent.setup({ document });
  expect(view.queryByRole('region', { name: 'OAuth app' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Connect account' })).toBeNull();
  await user.click(view.getByRole('button', { name: 'Save API key' }));
  expect(save).not.toHaveBeenCalled();
  await user.type(view.getByLabelText('API key'), 'synthetic-key');
  await user.click(view.getByRole('button', { name: 'Save API key' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith('synthetic-key'));
  expect((view.getByLabelText('API key') as HTMLInputElement).value).toBe('');
  view.rerender(<ProviderDetail {...props} pending />);
  expect((view.getByRole('button', { name: 'Save API key' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect((view.getByLabelText('API key') as HTMLInputElement).disabled).toBe(true);
  view.rerender(
    <ProviderDetail
      {...props}
      onSaveApiKey={() => Promise.reject(new Error('Invalid key'))}
      appError={new Error('Check the key access.')}
    />,
  );
  await user.type(view.getByLabelText('API key'), 'rejected-secret');
  await user.click(view.getByRole('button', { name: 'Save API key' }));
  await waitFor(() => expect((view.getByLabelText('API key') as HTMLInputElement).value).toBe(''));
  expect(view.getByRole('alert').textContent).toBe('Check the key access.');
});
