import { expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import type { Session } from '../src/lib/auth';
import { ownerRegistrationQueryOptions } from '../src/queries/owner-registration';
import { type KnowledgeProfile, profileQueryOptions } from '../src/queries/profile';
import { sessionQueryOptions } from '../src/queries/session';
import { routeTree } from '../src/routeTree.gen';

async function passkeyWorld({ signedIn, path }: { signedIn: boolean; path: string }) {
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
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      () => {
        throw new Error('Passkey help must not require an API call');
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
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
      },
    };
  } catch (error) {
    cleanup();
    client.clear();
    fetch.mockRestore();
    throw error;
  }
}

test('signed-in owners can find passkey settings for custom domains', async () => {
  const world = await passkeyWorld({ signedIn: true, path: '/settings/passkeys' });
  try {
    await screen.findByRole('heading', { name: 'Passkeys' });
    expect(screen.getByRole('link', { name: 'Passkeys' }).getAttribute('href')).toBe(
      '/settings/passkeys',
    );
    expect(screen.getByText('BASE_URL=https://context.example.com')).toBeTruthy();
    expect(screen.getByText(/only if you set a custom domain/)).toBeTruthy();
  } finally {
    world.dispose();
  }
});

test('passkey settings retain the settings authentication boundary', async () => {
  const world = await passkeyWorld({ signedIn: false, path: '/settings/passkeys' });
  try {
    await screen.findByRole('heading', { name: 'Create the owner account' });
    expect(world.router.state.location.pathname).toBe('/login');
    expect(world.router.state.location.search).toEqual({ redirect: '/settings/passkeys' });
  } finally {
    world.dispose();
  }
});
