import { expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAX_ASSET_BYTES } from '#backend/models/assets/model.ts';
import type { Session } from '../../src/lib/auth';
import type { AssetSummary } from '../../src/queries/assets';
import type { EntityDetail } from '../../src/queries/entities';
import { type KnowledgeProfile, profileQueryOptions } from '../../src/queries/profile';
import { sessionQueryOptions } from '../../src/queries/session';
import { routeTree } from '../../src/routeTree.gen';

async function creationWorld({ onboarding = false, failImage = false, failUpload = false } = {}) {
  const timestamp = new Date('2026-01-01');
  const asset: AssetSummary = {
    readableId: 'portrait',
    name: 'Portrait',
    mediaType: 'image/png',
    extension: 'png',
    sizeBytes: 100,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const entity: EntityDetail = {
    readableId: 'alice',
    name: 'Alice',
    description: 'Research colleague',
    entityType: 'person',
    isSelf: onboarding,
    image: null,
    pages: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  let profile: KnowledgeProfile | null = onboarding
    ? null
    : { selfEntity: { ...entity, readableId: 'owner', isSelf: true } };
  const session: Session = {
    session: {
      id: 'session',
      token: 'test-token',
      userId: 'owner',
      expiresAt: new Date('2099-01-01'),
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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(sessionQueryOptions.queryKey, session);
  client.setQueryData(profileQueryOptions.queryKey, profile);
  const writes: { path: string; body: unknown }[] = [];
  const reads: string[] = [];
  let imageFailed = false;
  let uploadFailed = false;
  async function writeResponse({ request, path }: { request: Request; path: string }) {
    const body = path === '/api/assets' ? await request.formData() : await request.json();
    writes.push({ path, body });
    switch (path) {
      case '/api/assets':
        if (failUpload && !uploadFailed) {
          uploadFailed = true;
          return Response.json({ message: 'Upload failed' }, { status: 500 });
        }
        return Response.json(asset);
      case '/api/entities/alice/image':
        if (failImage && !imageFailed) {
          imageFailed = true;
          return Response.json({ message: 'Image is already assigned' }, { status: 409 });
        }
        entity.image = asset;
        if (onboarding) {
          profile = { selfEntity: entity };
        }
        return Response.json(entity);
      case '/api/profile':
        profile = { selfEntity: entity };
        return Response.json(profile);
      case '/api/entities':
        return Response.json(entity);
      default:
        throw new Error(`Unexpected write: ${path}`);
    }
  }
  function readResponse(path: string) {
    reads.push(path);
    switch (path) {
      case '/api/profile':
        return profile
          ? Response.json(profile)
          : Response.json({ message: 'Not found' }, { status: 404 });
      case '/api/assets':
        return Response.json({ items: [asset], total: 1, nextOffset: null });
      case '/api/entities':
        return Response.json({ items: [entity], total: 1, nextOffset: null });
      case '/api/entities/alice':
        return Response.json(entity);
      default:
        throw new Error(`Unexpected read: ${path}`);
    }
  }
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (...args: Parameters<typeof globalThis.fetch>) => {
        const request = new Request(...args);
        const path = new URL(request.url).pathname;
        return request.method === 'GET'
          ? Promise.resolve(readResponse(path))
          : writeResponse({ request, path });
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  const router = createRouter({
    routeTree,
    context: { queryClient: client },
    history: createMemoryHistory({
      initialEntries: ['/entities/new?redirect=%2Fentities%2Falice'],
    }),
  });
  await router.load();
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup({ applyAccept: false });
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Alice');
  await user.type(
    screen.getByRole('textbox', { name: 'Distinguishing description' }),
    'Research colleague',
  );
  return {
    user,
    writes,
    reads,
    router,
    client,
    submit: () =>
      user.click(
        screen.getByRole('button', { name: onboarding ? 'Create my profile' : 'Create entity' }),
      ),
    dispose: () => {
      cleanup();
      client.clear();
      fetch.mockRestore();
    },
  };
}

for (const onboarding of [false, true]) {
  test(`creation resumes image assignment (${onboarding ? 'onboarding upload' : 'existing dashboard asset'})`, async () => {
    const world = await creationWorld({ onboarding, failImage: true });
    try {
      if (onboarding) {
        expect(screen.queryByRole('tab', { name: 'Choose existing' })).toBeNull();
        expect(world.reads).not.toContain('/api/assets');
        expect(screen.queryByRole('combobox', { name: 'Type' })).toBeNull();
        expect(screen.queryByText(/You can skip this for now/)).toBeNull();
        expect(screen.queryByText(/Up to .* MB/)).toBeNull();
        expect(screen.queryByRole('textbox', { name: 'Search image assets' })).toBeNull();
        expect(
          screen.getByText(/help Context Use recognize you in images you upload later/),
        ).toBeTruthy();
        await world.user.upload(
          screen.getByLabelText('Profile photo (optional)'),
          new File(['image'], 'portrait.png', { type: 'image/png' }),
        );
      } else {
        await world.user.click(screen.getByRole('tab', { name: 'Choose existing' }));
        await world.user.click(await screen.findByRole('button', { name: /Portrait/ }));
        expect(screen.getByRole('button', { name: /Portrait/ }).getAttribute('aria-pressed')).toBe(
          'true',
        );
      }
      await world.submit();
      await screen.findByText('Image is already assigned');
      expect(world.router.state.location.pathname).toBe('/entities/new');
      expect(
        (screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).closest('fieldset')
          ?.disabled,
      ).toBe(true);
      if (onboarding) {
        expect(world.client.getQueryData(profileQueryOptions.queryKey)).toBeNull();
      }
      await world.user.click(screen.getByRole('button', { name: 'Continue' }));
      await waitFor(() => expect(world.router.state.location.pathname).toBe('/entities/alice'));
      expect(world.writes.map((write) => write.path)).toEqual([
        ...(onboarding ? ['/api/assets', '/api/profile'] : ['/api/entities']),
        '/api/entities/alice/image',
        '/api/entities/alice/image',
      ]);
      expect(world.writes.at(-1)?.body).toEqual({
        assetReadableId: 'portrait',
        changeMessage: 'Assigned an image to the entity',
      });
      if (onboarding) {
        expect(world.writes.find((write) => write.path === '/api/profile')?.body).toMatchObject({
          entityType: 'person',
        });
      }
    } finally {
      world.dispose();
    }
  });
}

test('onboarding validates uploads, preserves the draft after upload failure, and creates an image asset', async () => {
  const world = await creationWorld({ onboarding: true, failUpload: true });
  try {
    const input = screen.getByLabelText('Profile photo (optional)');
    const oversized = new File(['image'], 'portrait.png', { type: 'image/png' });
    Object.defineProperty(oversized, 'size', { value: MAX_ASSET_BYTES + 1 });
    await world.user.upload(input, oversized);
    await world.submit();
    await screen.findByText(/Images can be at most/);
    expect(world.writes).toHaveLength(0);
    await world.user.upload(input, new File(['text'], 'notes.txt', { type: 'text/plain' }));
    await screen.findByText('Choose a PNG, JPEG, GIF, or WebP image.');
    await world.user.upload(input, new File(['image'], 'portrait.png', { type: 'image/png' }));
    await world.submit();
    await screen.findByText('Upload failed');
    expect(world.writes.map((write) => write.path)).toEqual(['/api/assets']);
    await world.submit();
    await waitFor(() => expect(world.router.state.location.pathname).toBe('/entities/alice'));
    expect(world.writes.map((write) => write.path)).toEqual([
      '/api/assets',
      '/api/assets',
      '/api/profile',
      '/api/entities/alice/image',
    ]);
    expect((world.writes[1]!.body as FormData).get('name')).toBe('Alice image');
  } finally {
    world.dispose();
  }
});

test('removing the image after assignment failure continues without creating another entity', async () => {
  const world = await creationWorld({ failImage: true });
  try {
    await world.user.upload(
      screen.getByLabelText('File'),
      new File(['image'], 'portrait.png', { type: 'image/png' }),
    );
    await world.submit();
    await screen.findByText('Image is already assigned');
    await world.user.click(screen.getByRole('button', { name: 'Remove image' }));
    await world.user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(world.router.state.location.pathname).toBe('/entities/alice'));
    expect(world.writes.map((write) => write.path)).toEqual([
      '/api/assets',
      '/api/entities',
      '/api/entities/alice/image',
    ]);
  } finally {
    world.dispose();
  }
});

for (const onboarding of [false, true]) {
  test(`creation without an image does not upload or assign an asset (${onboarding ? 'onboarding' : 'dashboard'})`, async () => {
    const world = await creationWorld({ onboarding });
    try {
      await world.submit();
      await waitFor(() => expect(world.router.state.location.pathname).toBe('/entities/alice'));
      expect(world.writes.map((write) => write.path)).toEqual([
        onboarding ? '/api/profile' : '/api/entities',
      ]);
    } finally {
      world.dispose();
    }
  });
}
