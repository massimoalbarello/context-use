import { afterEach, expect, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResourceNavigation } from '../../src/components/knowledge/resource-navigation';
import { ResourcePreviewPanel } from '../../src/components/knowledge/resource-preview-panel';
import type { ResourceSelection } from '../../src/lib/resource-selection';
import { type KnowledgePagePreview, pagePreviewQueryOptions } from '../../src/queries/pages';

afterEach(cleanup);

async function renderPreview(selection: ResourceSelection): Promise<string> {
  const queryClient = new QueryClient();
  if (selection.kind === 'page') {
    queryClient.setQueryData(pagePreviewQueryOptions(selection.readableId).queryKey, {
      markdown:
        '# Project brief\n\n[Maya Chen](context-use://entity/maya-chen) reviews the [launch plan](context-use://page/launch-plan), [metrics](context-use://asset/rollout-metrics), and [research](context-use://record/research).',
      mentions: [{ readableId: 'maya-chen', name: 'Maya Chen', image: null }],
      recordReferences: [
        { readableId: 'research', title: null, provider: 'notion', kind: 'note', available: false },
      ],
    } as KnowledgePagePreview);
  }
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ResourceNavigation value={{ selection, onSelect: () => undefined }}>
          <ResourcePreviewPanel
            onExpand={() => undefined}
            selection={selection}
            onClose={() => undefined}
          />
        </ResourceNavigation>
      </QueryClientProvider>
    ),
  });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/' });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

async function renderInteractivePreview(onClose: () => void) {
  const initialSelection = { kind: 'page' as const, readableId: 'project-brief' };
  const nextSelection = { kind: 'page' as const, readableId: 'delivery-brief' };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
  });
  const timestamp = new Date('2026-01-01T00:00:00.000Z');
  for (const [selection, title] of [
    [initialSelection, 'Project brief'],
    [nextSelection, 'Delivery brief'],
  ] as const) {
    queryClient.setQueryData(pagePreviewQueryOptions(selection.readableId).queryKey, {
      readableId: selection.readableId,
      title,
      excerpt: title,
      temporalCoverage: null,
      revisionNumber: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      markdown: `# ${title}`,
      mentions: [],
      recordReferences: [],
    } as KnowledgePagePreview);
  }
  function InteractivePreview() {
    const [selection, setSelection] = useState<ResourceSelection>(initialSelection);
    return (
      <>
        <button type="button" onClick={() => setSelection(nextSelection)}>
          Select another page
        </button>
        <ResourcePreviewPanel onExpand={() => undefined} selection={selection} onClose={onClose} />
      </>
    );
  }
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <InteractivePreview />
      </QueryClientProvider>
    ),
  });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/' });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}

test('page previews reuse resource links and keep unavailable records unlinked', async () => {
  const pageHtml = await renderPreview({ kind: 'page', readableId: 'project-brief' });

  expect(pageHtml).toContain('>launch plan</a>');
  expect(pageHtml).toContain('href="/assets/rollout-metrics"');
  expect(pageHtml).toContain('href="/entities/maya-chen"');
  expect(pageHtml).toContain('href="/pages/launch-plan?');
  expect(pageHtml).toContain('(record unavailable)');
  expect(pageHtml).not.toContain('href="/records/research');
});

test('each selected preview receives focus and handles Escape locally', async () => {
  const user = userEvent.setup();
  let closeCount = 0;
  await renderInteractivePreview(() => {
    closeCount += 1;
  });

  expect(document.activeElement).toBe(
    screen.getByRole('complementary', { name: 'Knowledge page preview' }),
  );

  await user.click(screen.getByRole('button', { name: 'Select another page' }));

  expect(screen.getByRole('heading', { name: 'Delivery brief' })).toBeTruthy();
  expect(document.activeElement).toBe(
    screen.getByRole('complementary', { name: 'Knowledge page preview' }),
  );

  await user.keyboard('{Escape}');

  expect(closeCount).toBe(1);
});
