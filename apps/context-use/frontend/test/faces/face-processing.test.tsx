import { expect, mock, spyOn, test } from 'bun:test';
import '../support/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FaceModelHealth } from '../../src/components/faces/face-processing';
import type { Session } from '../../src/lib/auth';
import type { FaceProcessing, FaceSettings } from '../../src/queries/faces';
import { type KnowledgeProfile, profileQueryOptions } from '../../src/queries/profile';
import { sessionQueryOptions } from '../../src/queries/session';
import { routeTree } from '../../src/routeTree.gen';

test('downloaded model files do not imply a usable engine and an in-progress check cannot be duplicated', async () => {
  const onCheck = mock(() => undefined);
  const user = userEvent.setup({ document });
  const model: FaceProcessing['model'] = {
    name: 'Face model',
    state: 'unavailable',
    downloaded: true,
    error: 'The engine could not load the model.',
    checkedAt: null,
  };
  const view = render(
    <FaceModelHealth model={model} pending={false} error={null} onCheck={onCheck} />,
  );
  try {
    expect(view.getByText('Unavailable')).toBeTruthy();
    expect(view.getByText(/Model files downloaded/)).toBeTruthy();
    expect(view.getByText(model.error!)).toBeTruthy();
    await user.click(view.getByRole('button', { name: 'Check model' }));
    expect(onCheck).toHaveBeenCalledTimes(1);
    view.rerender(
      <FaceModelHealth
        model={{ ...model, state: 'checking', error: null }}
        pending={false}
        error={null}
        onCheck={onCheck}
      />,
    );
    const checking = view.getByRole('button', { name: 'Checking…' }) as HTMLButtonElement;
    expect(checking.disabled).toBe(true);
    await user.click(checking);
    expect(onCheck).toHaveBeenCalledTimes(1);
  } finally {
    cleanup();
  }
});

function authenticatedClient() {
  const timestamp = new Date('2026-01-01T00:00:00.000Z');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  const session: Session = {
    session: {
      id: 'session',
      token: 'test-token',
      userId: 'owner',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    user: {
      id: 'owner',
      name: 'Owner',
      email: 'owner@example.com',
      emailVerified: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
  client.setQueryData(sessionQueryOptions.queryKey, session);
  const profile: KnowledgeProfile = {
    selfEntity: {
      readableId: 'owner',
      name: 'Owner',
      description: 'The owner.',
      entityType: null,
      isSelf: true,
      image: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
  client.setQueryData(profileQueryOptions.queryKey, profile);
  return client;
}

test('settings restores the queue filter, retries a failed image, and resets pagination when changing views', async () => {
  const client = authenticatedClient();
  const timestamp = new Date('2026-01-01T00:00:00.000Z');
  const failed: FaceProcessing['items'][number] = {
    asset: {
      readableId: 'group-photo',
      name: 'Group photo',
      mediaType: 'image/jpeg',
      extension: 'jpg',
      sizeBytes: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    state: 'failed',
    error: 'Image could not be decoded.',
  };
  let retried = false;
  const settings: FaceSettings = {
    model: { analysisVersion: 'test-v1', defaultThreshold: 0.363 },
    threshold: 0.363,
  };
  const handleRequest = (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname === '/api/face-recognition/settings') {
      return Response.json(settings);
    }
    if (url.pathname === '/api/face-recognition/processing') {
      return Response.json({
        model: {
          name: 'Face model',
          state: 'ready',
          downloaded: true,
          error: null,
          checkedAt: null,
        },
        counts: { queued: Number(retried), failed: Number(!retried), ready: 0, unsupported: 0 },
        items: url.searchParams.get('filter') === 'failed' && !retried ? [failed] : [],
        nextOffset: null,
      } satisfies FaceProcessing);
    }
    if (url.pathname === '/api/assets/group-photo/faces/analyze' && request.method === 'POST') {
      retried = true;
      return Response.json({ state: 'queued', error: null, outdated: false, faces: [] });
    }
    throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
  };
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (...args: Parameters<typeof globalThis.fetch>) =>
        Promise.resolve(handleRequest(new Request(...args))),
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/settings/faces?filter=failed&offset=20'] }),
    context: { queryClient: client },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  try {
    const user = userEvent.setup({ document });
    expect(await view.findByText('Image could not be decoded.')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Failed', pressed: true })).toBeTruthy();
    expect(view.getByRole('link', { name: /Group photo/ }).getAttribute('href')).toBe(
      '/assets/group-photo',
    );
    await user.click(view.getByRole('button', { name: 'Retry Group photo' }));
    expect(await view.findByText('No failed images.')).toBeTruthy();
    expect(retried).toBe(true);
    await user.click(view.getByRole('button', { name: 'Pending' }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ filter: 'pending', offset: 0 }),
    );
    expect(view.getByRole('heading', { name: 'Face recognition' })).toBeTruthy();
    expect(view.getByRole('button', { name: 'Pending', pressed: true })).toBeTruthy();
  } finally {
    cleanup();
    client.clear();
    fetch.mockRestore();
  }
});
