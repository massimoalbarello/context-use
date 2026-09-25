import { afterEach, expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from '../../src/lib/auth';
import type { KnowledgePageSummary } from '../../src/queries/pages';
import { type KnowledgeProfile, profileQueryOptions } from '../../src/queries/profile';
import type { PublicSiteSettings } from '../../src/queries/public-site';
import { sessionQueryOptions } from '../../src/queries/session';
import { routeTree } from '../../src/routeTree.gen';

afterEach(cleanup);

test('settings select only published pages, confirm changes, and remove the homepage without unpublishing', async () => {
  const date = new Date('2026-09-25');
  const session: Session = {
    user: {
      id: 'owner',
      name: 'Owner',
      email: 'owner@example.invalid',
      emailVerified: true,
      createdAt: date,
      updatedAt: date,
    },
    session: {
      id: 'session',
      userId: 'owner',
      token: 'test',
      expiresAt: new Date('2099-01-01'),
      createdAt: date,
      updatedAt: date,
    },
  };
  const page: KnowledgePageSummary = {
    readableId: 'welcome',
    title: 'Welcome',
    excerpt: 'Start here',
    revisionNumber: 1,
    temporalCoverage: null,
    createdAt: date,
    updatedAt: date,
  };
  let settings: PublicSiteSettings = { homepage: null };
  const saves: unknown[] = [];
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (...args: Parameters<typeof globalThis.fetch>) => {
        const request = new Request(...args);
        const url = new URL(request.url);
        if (url.pathname === '/api/public-site') {
          return Response.json(settings);
        }
        if (url.pathname === '/api/pages') {
          expect(url.searchParams.get('visibility')).toBe('public');
          return Response.json({ items: [page], total: 1, nextOffset: null });
        }
        if (url.pathname === '/api/public-site/homepage' && request.method === 'PUT') {
          const body = await request.json();
          saves.push(body);
          settings = {
            homepage: body.readableId
              ? { readableId: page.readableId, title: page.title, publicId: 'public-id' }
              : null,
          };
          return Response.json({ saved: true });
        }
        throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(sessionQueryOptions.queryKey, session);
  const profile: KnowledgeProfile = {
    selfEntity: {
      readableId: 'owner',
      name: 'Owner',
      description: 'Owner',
      entityType: 'person',
      isSelf: true,
      image: null,
      createdAt: date,
      updatedAt: date,
    },
  };
  client.setQueryData(profileQueryOptions.queryKey, profile);
  const router = createRouter({
    routeTree,
    context: { queryClient: client },
    history: createMemoryHistory({ initialEntries: ['/app/settings/public-site'] }),
  });
  try {
    await router.load();
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const user = userEvent.setup({ document });
    expect(screen.getByText('Your public site shows “Nothing published yet”.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View public site' }).getAttribute('href')).toBe(
      '/public',
    );
    await user.click(screen.getByRole('button', { name: 'Set homepage' }));
    await user.click(await screen.findByRole('radio', { name: /Welcome/ }));
    await user.click(screen.getByRole('button', { name: 'Set homepage' }));
    let dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText('Visitors to your public site will start on this page.'),
    ).toBeTruthy();
    expect(saves).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(saves).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Set homepage' }));
    dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Set homepage' }));
    await screen.findByRole('button', { name: 'Change homepage' });
    expect(saves).toEqual([{ readableId: 'welcome' }]);
    expect(screen.getByRole('link', { name: 'Welcome' }).getAttribute('href')).toBe(
      '/app/pages/welcome',
    );
    await user.click(screen.getByRole('button', { name: 'Remove homepage' }));
    dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('This page will stay published.');
    await user.click(within(dialog).getByRole('button', { name: 'Remove homepage' }));
    await waitFor(() =>
      expect(screen.getByText('Your public site shows “Nothing published yet”.')).toBeTruthy(),
    );
    expect(saves).toEqual([{ readableId: 'welcome' }, { readableId: null }]);
  } finally {
    cleanup();
    client.clear();
    fetch.mockRestore();
  }
});
