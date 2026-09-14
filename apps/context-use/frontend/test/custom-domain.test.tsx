import { expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from '../src/lib/auth';
import { ownerRegistrationQueryOptions } from '../src/queries/owner-registration';
import { type KnowledgeProfile, profileQueryOptions } from '../src/queries/profile';
import { sessionQueryOptions } from '../src/queries/session';
import { routeTree } from '../src/routeTree.gen';

async function domainWorld({ signedIn, path }: { signedIn: boolean; path: string }) {
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
        throw new Error('Domain help must not require an API call');
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

test('custom-domain setup is discoverable before signup', async () => {
  const world = await domainWorld({ signedIn: false, path: '/login' });
  try {
    await screen.findByRole('heading', { name: 'Create the owner account' });
    const help = screen.getByText('Using a custom domain?');
    await userEvent.setup().click(help);
    expect(help.closest('details')?.open).toBe(true);
    expect(screen.getByText(/before or after creating your account/)).toBeTruthy();
    expect(screen.getByText('BASE_URL')).toBeTruthy();
    expect(screen.getByText(/If your browser or passkey provider/)).toBeTruthy();
  } finally {
    world.dispose();
  }
});

test('signed-in owners can find custom-domain instructions in Settings', async () => {
  const world = await domainWorld({ signedIn: true, path: '/settings/domain' });
  try {
    await screen.findByRole('heading', { name: 'Custom domain' });
    expect(screen.getByRole('link', { name: 'Custom domain' }).getAttribute('href')).toBe(
      '/settings/domain',
    );
    expect(screen.getByText(/Keep the same nibrun app/)).toBeTruthy();
    expect(screen.getByText(/update your MCP clients/)).toBeTruthy();
  } finally {
    world.dispose();
  }
});

test('custom-domain settings retain the settings authentication boundary', async () => {
  const world = await domainWorld({ signedIn: false, path: '/settings/domain' });
  try {
    await screen.findByRole('heading', { name: 'Create the owner account' });
    expect(world.router.state.location.pathname).toBe('/login');
    expect(world.router.state.location.search).toEqual({ redirect: '/settings/domain' });
  } finally {
    world.dispose();
  }
});
