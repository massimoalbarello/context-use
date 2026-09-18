import { afterEach, expect, mock, test } from 'bun:test';
import '../support/dom';
import { cleanup, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OAuthAppSetup } from '../../src/components/syncs/oauth-app-setup';

afterEach(cleanup);
const callbackUrl = 'https://context.example/api/open-sync/oauth/callback';

test('app setup guides creation before collecting credentials and clears the submitted secret', async () => {
  const save = mock(() => {});
  const view = render(
    <OAuthAppSetup
      providerName="GitHub"
      createAppUrl="https://github.com/settings/applications/new"
      callbackUrl={callbackUrl}
      configured={false}
      pending={false}
      error={null}
      onSave={save}
      onCancel={() => {}}
    />,
  );
  const user = userEvent.setup({ document });
  expect((view.getByLabelText('Authorization callback URL') as HTMLInputElement).value).toBe(
    callbackUrl,
  );
  expect((view.getByLabelText('Homepage URL') as HTMLInputElement).value).toBe(
    'https://context.example/',
  );
  expect(view.getByRole('link', { name: /Create OAuth app/ }).getAttribute('href')).toBe(
    'https://github.com/settings/applications/new',
  );
  expect(view.queryByLabelText('Client secret')).toBeNull();
  await user.click(view.getByRole('button', { name: 'I have an OAuth app' }));
  expect(view.queryByText('Enter your client secret.')).toBeNull();
  await user.click(view.getByRole('button', { name: 'Save OAuth app' }));
  expect(await view.findByText('Enter your client secret.')).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
  await user.type(view.getByLabelText('Client ID'), '  client  ');
  const secret = view.getByLabelText('Client secret') as HTMLInputElement;
  await user.type(secret, '  secret  ');
  await user.click(view.getByRole('button', { name: 'Save OAuth app' }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({ clientId: 'client', clientSecret: 'secret' }),
  );
  expect(secret.value).toBe('');
});

test('editing a configured app requests both credentials and keeps setup instructions available', async () => {
  const view = render(
    <OAuthAppSetup
      providerName="GitHub"
      createAppUrl="https://github.com/settings/applications/new"
      callbackUrl={callbackUrl}
      configured
      pending={false}
      error={new Error('Could not save your GitHub app.')}
      onSave={() => {}}
      onCancel={() => {}}
    />,
  );
  const user = userEvent.setup({ document });
  expect((view.getByLabelText('Client secret') as HTMLInputElement).value).toBe('');
  expect((view.getByLabelText('Client ID') as HTMLInputElement).value).toBe('');
  expect(view.getByRole('alert').textContent).toContain('Could not save');
  await user.click(view.getByRole('button', { name: 'Setup instructions' }));
  expect(view.getByLabelText('Authorization callback URL')).toBeTruthy();
});
