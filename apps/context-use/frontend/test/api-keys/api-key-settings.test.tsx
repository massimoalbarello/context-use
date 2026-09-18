import { afterEach, expect, mock, test } from 'bun:test';
import '../support/dom';
import { cleanup, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ApiKeySettings,
  CreateApiKeyForm,
  NewApiKeyCredential,
} from '../../src/components/api-keys/api-key-settings';

afterEach(cleanup);

const created = {
  key: {
    readableId: 'engineering-activity-a1b2c3d4e5f60718293a4b5c',
    name: 'Engineering activity',
    createdAt: '2026-09-09T09:00:00.000Z',
    revokedAt: null,
  },
  apiKey: '01991f43-0c00-7000-8000-000000000041',
};

function apiKeySettingsProps(overrides: Partial<Parameters<typeof ApiKeySettings>[0]> = {}) {
  return {
    keys: [],
    created: undefined,
    recordEndpoint: 'https://context.example/api/records',
    creating: false,
    createError: null,
    revokingReadableId: null,
    revokeError: null,
    onCreate: () => undefined,
    onResetCreate: () => undefined,
    onRevoke: () => undefined,
    ...overrides,
  };
}

test('key creation requires a name and submits its trimmed name', async () => {
  const onSubmit = mock(() => undefined);
  const onCancel = mock(() => undefined);
  const user = userEvent.setup({ document });
  const view = render(
    <CreateApiKeyForm pending={false} error={null} onSubmit={onSubmit} onCancel={onCancel} />,
  );

  await user.click(view.getByRole('button', { name: 'Create API key' }));
  expect((await view.findByRole('alert')).textContent).toContain('Enter a name for this key.');
  expect(onSubmit).not.toHaveBeenCalled();

  await user.type(view.getByRole('textbox', { name: 'Key name' }), '  Engineering activity  ');
  await user.click(view.getByRole('button', { name: 'Create API key' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Engineering activity'));
});

test('key setup stays hidden until add key is selected', async () => {
  const onReset = mock(() => undefined);
  const user = userEvent.setup({ document });
  const view = render(<ApiKeySettings {...apiKeySettingsProps({ onResetCreate: onReset })} />);

  expect(view.getByRole('heading', { name: 'Active keys' })).toBeTruthy();
  expect(view.queryByRole('textbox', { name: 'Key name' })).toBeNull();
  expect(view.queryByRole('textbox', { name: 'Record endpoint' })).toBeNull();

  await user.click(view.getByRole('button', { name: 'Create API key' }));
  expect(view.getByRole('textbox', { name: 'Key name' })).toBeTruthy();
  expect(view.queryByRole('textbox', { name: 'Record endpoint' })).toBeNull();

  await user.click(view.getByRole('button', { name: 'Cancel' }));
  expect(view.queryByRole('textbox', { name: 'Key name' })).toBeNull();
  expect(onReset).toHaveBeenCalledTimes(2);
});

test('new credentials expose the generic endpoint and UUIDv7 key with copy actions', async () => {
  const writes: string[] = [];
  const user = userEvent.setup({ document });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (value: string) => writes.push(value) },
  });
  const onDone = mock(() => undefined);
  const recordEndpoint = 'https://context.example/api/records';
  const view = render(
    <NewApiKeyCredential created={created} recordEndpoint={recordEndpoint} onDone={onDone} />,
  );

  expect((view.getByRole('textbox', { name: 'Record endpoint' }) as HTMLInputElement).value).toBe(
    recordEndpoint,
  );
  expect((view.getByRole('textbox', { name: 'API key' }) as HTMLInputElement).value).toBe(
    created.apiKey,
  );
  expect(view.getByText(/won’t be shown again/i)).toBeTruthy();

  await user.click(view.getByRole('button', { name: /copy api key/i }));
  await waitFor(() => expect(writes).toEqual([created.apiKey]));
  expect(view.getByText('API key copied.')).toBeTruthy();

  await user.click(view.getByRole('button', { name: 'I saved the key' }));
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('key settings separates active and revoked API keys while preserving the revoke warning', () => {
  const view = render(
    <ApiKeySettings
      {...apiKeySettingsProps({
        keys: [
          created.key,
          {
            ...created.key,
            readableId: 'old-key-a1b2c3d4e5f60718293a4b5c',
            name: 'Old key',
            revokedAt: '2026-09-09T10:00:00.000Z',
          },
        ],
      })}
    />,
  );

  expect(view.getByRole('heading', { name: 'Active keys' })).toBeTruthy();
  expect(view.getByRole('heading', { name: 'Revoked API keys' })).toBeTruthy();
  expect(view.getByText('Engineering activity')).toBeTruthy();
  expect(view.getByText('Old key')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Revoke' }).getAttribute('aria-haspopup')).toBe('dialog');
});
