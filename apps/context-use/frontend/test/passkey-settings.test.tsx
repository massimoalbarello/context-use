import { expect, spyOn, test } from 'bun:test';
import type { Passkey } from '@better-auth/passkey';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from '../src/lib/auth';
import { ownerRegistrationQueryOptions } from '../src/queries/owner-registration';
import * as passkeyQueries from '../src/queries/passkeys';
import { userPasskeysQueryOptions } from '../src/queries/passkeys';
import { type KnowledgeProfile, profileQueryOptions } from '../src/queries/profile';
import { sessionQueryOptions } from '../src/queries/session';
import { routeTree } from '../src/routeTree.gen';

function passkeyFixture({
  id,
  name,
  createdAt,
}: {
  id: string;
  name: string;
  createdAt: string;
}): Passkey {
  return {
    id,
    name,
    publicKey: 'public-key',
    userId: 'owner',
    credentialID: `credential-${id}`,
    counter: 0,
    deviceType: 'singleDevice',
    backedUp: false,
    createdAt: new Date(createdAt),
    aaguid: '00000000-0000-0000-0000-000000000000',
  };
}

async function passkeyWorld({
  signedIn,
  path,
  passkeys = [],
  addPasskey = () => Promise.resolve(),
  updatePasskey = () => Promise.resolve(),
}: {
  signedIn: boolean;
  path: string;
  passkeys?: Passkey[];
  addPasskey?: typeof passkeyQueries.addPasskey;
  updatePasskey?: typeof passkeyQueries.updatePasskey;
}) {
  const now = new Date();
  const session: Session = {
    session: {
      id: 'session',
      token: 'token',
      userId: 'owner',
      expiresAt: new Date('2099-01-01'),
      createdAt: now,
      updatedAt: now,
    },
    user: {
      id: 'owner',
      name: 'Owner',
      email: 'owner@example.com',
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  };
  const profile: KnowledgeProfile = {
    selfEntity: {
      publishedAt: null,
      readableId: 'owner',
      name: 'Owner',
      description: '',
      entityType: 'person',
      isSelf: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(sessionQueryOptions.queryKey, signedIn ? session : null);
  client.setQueryData(profileQueryOptions.queryKey, signedIn ? profile : null);
  client.setQueryData(ownerRegistrationQueryOptions.queryKey, { ownerRegistered: false });
  client.setQueryData(userPasskeysQueryOptions.queryKey, [...passkeys]);
  const authMocks = [
    spyOn(passkeyQueries, 'addPasskey').mockImplementation(addPasskey),
    spyOn(passkeyQueries, 'updatePasskey').mockImplementation(updatePasskey),
    spyOn(userPasskeysQueryOptions, 'queryFn').mockImplementation(() =>
      Promise.resolve([...passkeys]),
    ),
  ];
  const fetchImplementation = Object.assign(
    (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === '/.well-known/webauthn') {
        return Promise.resolve(
          Response.json({
            origins: ['https://original.example.com', 'https://custom.example.org'],
          }),
        );
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    },
    { preconnect: globalThis.fetch.preconnect },
  );
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(fetchImplementation);
  const router = createRouter({
    routeTree,
    context: { queryClient: client },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  try {
    await router.load();
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    return {
      router,
      dispose: () => {
        cleanup();
        client.clear();
        fetch.mockRestore();
        for (const mock of authMocks) {
          mock.mockRestore();
        }
      },
    };
  } catch (error) {
    cleanup();
    client.clear();
    fetch.mockRestore();
    for (const mock of authMocks) {
      mock.mockRestore();
    }
    throw error;
  }
}

test('signed-in owners can find allowed passkey origins and configuration guidance', async () => {
  const world = await passkeyWorld({ signedIn: true, path: '/app/settings/passkeys' });
  try {
    await screen.findByRole('heading', { name: 'Passkeys' });
    expect(screen.getByRole('link', { name: 'Passkeys' }).getAttribute('href')).toBe(
      '/app/settings/passkeys',
    );
    expect(screen.getByText('BASE_URL')).toBeTruthy();
    expect(screen.getByText(/These are the domains where passkey sign-in is allowed/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Known origins' })).toBeTruthy();
    expect(screen.getByText('https://original.example.com')).toBeTruthy();
    expect(screen.getByText('https://custom.example.org')).toBeTruthy();
  } finally {
    world.dispose();
  }
});

test('passkey settings retain the settings authentication boundary', async () => {
  const world = await passkeyWorld({ signedIn: false, path: '/app/settings/passkeys' });
  try {
    await screen.findByRole('heading', { name: 'Create your account' });
    expect(world.router.state.location.pathname).toBe('/app/login');
    expect(world.router.state.location.search).toEqual({ redirect: '/app/settings/passkeys' });
  } finally {
    world.dispose();
  }
});

test('passkey settings manage equivalent credentials while retaining the final one', async () => {
  const world = await passkeyWorld({
    signedIn: true,
    path: '/app/settings/passkeys',
    passkeys: [
      passkeyFixture({
        id: 'passkey-1',
        name: 'Laptop passkey',
        createdAt: '2026-10-21T12:00:00.000Z',
      }),
      passkeyFixture({
        id: 'passkey-2',
        name: 'Phone passkey',
        createdAt: '2026-10-21T12:05:00.000Z',
      }),
    ],
  });
  try {
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Registered passkeys' });
    expect(screen.getByRole('button', { name: 'Add passkey' })).toBeTruthy();
    expect(screen.getByText('Laptop passkey')).toBeTruthy();
    expect(screen.getByText('Phone passkey')).toBeTruthy();

    await user.click(screen.getAllByRole('button', { name: 'Remove' })[0]!);
    await screen.findByRole('heading', { name: 'Remove Laptop passkey?' });
    expect(screen.getByRole('button', { name: 'Remove passkey' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByText('Laptop passkey')).toBeTruthy();
    expect(screen.getByText('Phone passkey')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2);
  } finally {
    world.dispose();
  }
});

test('passkey settings keep the final registered passkey available for sign-in', async () => {
  const world = await passkeyWorld({
    signedIn: true,
    path: '/app/settings/passkeys',
    passkeys: [
      passkeyFixture({
        id: 'passkey-1',
        name: 'Laptop passkey',
        createdAt: '2026-10-21T12:00:00.000Z',
      }),
    ],
  });
  try {
    await screen.findByText('Laptop passkey');
    expect(screen.queryByText('Add another passkey before removing this one.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy();
  } finally {
    world.dispose();
  }
});

test('passkey names edit in place, discard cancelled drafts, and refresh after saving', async () => {
  const passkeys = [passkeyFixture({ id: 'passkey-1', name: 'Laptop', createdAt: '2026-10-21' })];
  const world = await passkeyWorld({
    signedIn: true,
    path: '/app/settings/passkeys',
    passkeys,
    updatePasskey: (input) => {
      expect(input).toEqual({ id: 'passkey-1', name: 'Work laptop' });
      passkeys[0] = { ...passkeys[0]!, name: input.name };
      return Promise.resolve();
    },
  });
  try {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Rename' }));
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
    const input = screen.getByRole('textbox', { name: 'Passkey name' });
    expect(input.getAttribute('value')).toBe('Laptop');
    await user.clear(input);
    await user.type(input, 'Discard this');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Laptop')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const nextInput = screen.getByRole('textbox', { name: 'Passkey name' });
    expect(nextInput.getAttribute('value')).toBe('Laptop');
    await user.clear(nextInput);
    await user.type(nextInput, '  Work laptop  ');
    await user.click(screen.getByRole('button', { name: 'Save passkey' }));
    await screen.findByText('Work laptop');
    expect(screen.queryByRole('textbox', { name: 'Passkey name' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy();
  } finally {
    world.dispose();
  }
});

test('failed passkey renames retain the draft and allow a retry', async () => {
  const passkeys = [passkeyFixture({ id: 'passkey-1', name: '', createdAt: '2026-10-21' })];
  let attempts = 0;
  const world = await passkeyWorld({
    signedIn: true,
    path: '/app/settings/passkeys',
    passkeys,
    updatePasskey: (input) => {
      expect(input).toEqual({ id: 'passkey-1', name: 'Phone' });
      attempts++;
      if (attempts === 1) {
        return Promise.reject(new Error('Could not save the name.'));
      }
      passkeys[0] = { ...passkeys[0]!, name: input.name };
      return Promise.resolve();
    },
  });
  try {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Rename' }));
    expect(screen.queryByRole('alert')).toBeNull();
    const input = screen.getByRole('textbox', { name: 'Passkey name' });
    await user.clear(input);
    await user.type(input, '   ');
    await user.click(screen.getByRole('button', { name: 'Save passkey' }));
    await screen.findByText('Enter a name for this passkey.');
    expect(attempts).toBe(0);
    await user.clear(input);
    await user.type(input, 'Phone');
    await user.click(screen.getByRole('button', { name: 'Save passkey' }));
    await screen.findByText('Could not save the name.');
    expect(input.getAttribute('value')).toBe('Phone');
    await user.click(screen.getByRole('button', { name: 'Save passkey' }));
    await screen.findByText('Phone');
    expect(attempts).toBe(2);
    expect(screen.queryByRole('alert')).toBeNull();
  } finally {
    world.dispose();
  }
});

test('adding a passkey validates its name and refreshes the list after registration', async () => {
  const passkeys: Passkey[] = [];
  let registrations = 0;
  const world = await passkeyWorld({
    signedIn: true,
    path: '/app/settings/passkeys',
    passkeys,
    addPasskey: (name) => {
      expect(name).toBe('Phone');
      registrations++;
      passkeys.push(passkeyFixture({ id: 'passkey-1', name, createdAt: '2026-10-21' }));
      return Promise.resolve();
    },
  });
  try {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add passkey' }));
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add passkey' }));
    await screen.findByText('Enter a name for this passkey.');
    expect(registrations).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox', { name: 'Passkey name' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add passkey' }));
    await user.type(screen.getByRole('textbox', { name: 'Passkey name' }), '  Phone  ');
    await user.click(screen.getByRole('button', { name: 'Add passkey' }));
    await screen.findByText('Phone');
    expect(registrations).toBe(1);
    expect(screen.queryByRole('textbox', { name: 'Passkey name' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  } finally {
    world.dispose();
  }
});
