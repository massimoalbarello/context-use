import { expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssetFaces } from '../../src/components/faces/asset-faces';
import type { EntityPage } from '../../src/queries/entities';
import type { AnnotationInput, AssetFaces as AssetFacesData } from '../../src/queries/faces';

function renderFaces(handleRequest: (request: Request) => Promise<Response>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (...args: Parameters<typeof globalThis.fetch>) => handleRequest(new Request(...args)),
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  const view = render(
    <QueryClientProvider client={client}>
      <AssetFaces asset={{ readableId: 'group-photo', name: 'Group photo' }}>
        {({ preview, processAction }) => (
          <>
            {preview}
            <aside aria-label="Asset actions">{processAction}</aside>
          </>
        )}
      </AssetFaces>
    </QueryClientProvider>,
  );
  return {
    view,
    dispose() {
      cleanup();
      client.clear();
      fetch.mockRestore();
    },
  };
}

test('face boxes support keyboard review and dismissed detections can be restored from their boxes', async () => {
  let result: AssetFacesData = {
    state: 'ready',
    error: null,
    outdated: false,
    faces: [
      {
        readableId: 'face-one',
        box: [0, 0, 1, 1],
        decision: 'automatic',
        entity: null,
        similarity: null,
        needsReview: false,
      },
    ],
  };
  const decisions: AnnotationInput['body'][] = [];
  const { view, dispose } = renderFaces(async (request) => {
    const path = new URL(request.url).pathname;
    if (path === '/api/entities') {
      return Response.json({ items: [], total: 0, nextOffset: null } satisfies EntityPage);
    }
    if (path === '/api/assets/group-photo/faces/face-one/annotation') {
      const body: AnnotationInput['body'] = await request.json();
      decisions.push(body);
      result = {
        ...result,
        faces: result.faces.map((face) => ({ ...face, decision: body.decision })),
      };
      return Response.json(result);
    }
    if (path === '/api/assets/group-photo/faces') {
      return Response.json(result);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  try {
    const user = userEvent.setup({ document });
    const box = await view.findByRole('button', { name: 'Review face: Unknown' });
    expect(box.textContent).toBe('Unknown');
    box.focus();
    await user.keyboard('{Enter}');
    expect(await view.findByRole('dialog', { name: 'Review face' })).toBeTruthy();
    await user.click(view.getByRole('button', { name: 'Not a face' }));
    await waitFor(() => expect(view.getByText('Not a face', { selector: 'strong' })).toBeTruthy());
    await user.click(view.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
    expect(view.queryByRole('button', { name: 'Review face: Unknown' })).toBeNull();
    expect(view.queryByText('No faces found.')).toBeNull();
    await user.click(view.getByRole('button', { name: 'Show dismissed faces (1)' }));
    await user.click(view.getByRole('button', { name: 'Review face: Not a face' }));
    await user.click(await view.findByRole('button', { name: 'Use automatic matching' }));
    await waitFor(() => expect(view.getByText('Automatic matching')).toBeTruthy());
    await user.click(view.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
    expect(view.getByRole('button', { name: 'Review face: Unknown' })).toBeTruthy();
    expect(view.queryByRole('button', { name: /dismissed faces/ })).toBeNull();
    expect(decisions).toEqual([{ decision: 'dismissed' }, { decision: 'automatic' }]);
  } finally {
    dispose();
  }
});

test('processing through the action slot prevents duplicate requests and remains retryable after failure', async () => {
  const result: AssetFacesData = { state: 'ready', error: null, outdated: false, faces: [] };
  const failedAnalysis = Promise.withResolvers<Response>();
  let attempts = 0;
  const { view, dispose } = renderFaces(async (request) => {
    const path = new URL(request.url).pathname;
    if (path === '/api/assets/group-photo/faces/analyze') {
      attempts += 1;
      if (attempts === 1) {
        return await failedAnalysis.promise;
      }
      return Response.json(result);
    }
    if (path === '/api/assets/group-photo/faces') {
      return Response.json(result);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  try {
    const user = userEvent.setup({ document });
    await user.click(await view.findByRole('button', { name: 'Process image' }));
    const processing = (await view.findByRole('button', {
      name: 'Processing…',
    })) as HTMLButtonElement;
    expect(processing.disabled).toBe(true);
    await user.click(processing);
    expect(attempts).toBe(1);
    failedAnalysis.resolve(Response.json({ error: 'Engine unavailable' }, { status: 503 }));
    expect((await view.findByRole('alert')).textContent).toContain('Engine unavailable');
    expect(view.getByRole('img', { name: 'Group photo' })).toBeTruthy();
    await user.click(view.getByRole('button', { name: 'Process image' }));
    await waitFor(() => expect(attempts).toBe(2));
    await waitFor(() => expect(view.queryByRole('alert')).toBeNull());
    await waitFor(() =>
      expect(
        (view.getByRole('button', { name: 'Process image' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  } finally {
    dispose();
  }
});
