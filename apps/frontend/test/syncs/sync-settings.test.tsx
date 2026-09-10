import { afterEach, expect, mock, test } from 'bun:test';
import '../support/dom';
import { cleanup, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CreateSyncForm,
  NewSyncCredential,
  SyncCreation,
  SyncList,
} from '../../src/components/syncs/sync-settings';

afterEach(cleanup);

const created = {
  sync: {
    readableId: 'engineering-activity-a1b2c3d4e5f60718293a4b5c',
    name: 'Engineering activity',
    createdAt: '2026-09-09T09:00:00.000Z',
    revokedAt: null,
  },
  apiKey: '01991f43-0c00-7000-8000-000000000041',
};

test('sync creation requires a name and submits its trimmed external-service identity', async () => {
  const onSubmit = mock(() => undefined);
  const onCancel = mock(() => undefined);
  const user = userEvent.setup({ document });
  const view = render(
    <CreateSyncForm pending={false} error={null} onSubmit={onSubmit} onCancel={onCancel} />,
  );

  await user.click(view.getByRole('button', { name: 'Add sync' }));
  expect((await view.findByRole('alert')).textContent).toContain('Enter a name for this sync.');
  expect(onSubmit).not.toHaveBeenCalled();

  await user.type(view.getByRole('textbox', { name: 'Sync name' }), '  Engineering activity  ');
  await user.click(view.getByRole('button', { name: 'Add sync' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Engineering activity'));
});

test('sync setup stays hidden until add sync is selected', async () => {
  const onReset = mock(() => undefined);
  const user = userEvent.setup({ document });
  const view = render(
    <SyncCreation
      created={undefined}
      recordEndpoint="https://context.example/api/records"
      pending={false}
      error={null}
      onSubmit={() => undefined}
      onReset={onReset}
    />,
  );

  expect(view.queryByRole('textbox', { name: 'Sync name' })).toBeNull();
  expect(view.queryByRole('textbox', { name: 'Record endpoint' })).toBeNull();

  await user.click(view.getByRole('button', { name: 'Add sync' }));
  expect(view.getByRole('textbox', { name: 'Sync name' })).toBeTruthy();
  expect(view.queryByRole('textbox', { name: 'Record endpoint' })).toBeNull();

  await user.click(view.getByRole('button', { name: 'Cancel' }));
  expect(view.queryByRole('textbox', { name: 'Sync name' })).toBeNull();
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
    <NewSyncCredential created={created} recordEndpoint={recordEndpoint} onDone={onDone} />,
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

test('sync list separates authorized and revoked senders while preserving the revoke warning', () => {
  const view = render(
    <SyncList
      syncs={[
        created.sync,
        {
          ...created.sync,
          readableId: 'old-sync-a1b2c3d4e5f60718293a4b5c',
          name: 'Old sync',
          revokedAt: '2026-09-09T10:00:00.000Z',
        },
      ]}
      revokingReadableId={null}
      error={null}
      onRevoke={() => undefined}
    />,
  );

  expect(view.getByRole('heading', { name: 'Authorized syncs' })).toBeTruthy();
  expect(view.getByRole('heading', { name: 'Revoked syncs' })).toBeTruthy();
  expect(view.getByText('Engineering activity')).toBeTruthy();
  expect(view.getByText('Old sync')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Revoke' }).getAttribute('aria-haspopup')).toBe('dialog');
});
