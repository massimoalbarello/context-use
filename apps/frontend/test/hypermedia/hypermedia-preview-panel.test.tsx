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
import { HypermediaPreviewPanel } from '../../src/components/hypermedia/hypermedia-preview-panel';
import type { HypermediaSelection } from '../../src/components/hypermedia/hypermedia-selection';
import { type KnowledgePagePreview, pagePreviewQueryOptions } from '../../src/queries/pages';

afterEach(cleanup);

async function renderPreview(selection: HypermediaSelection): Promise<string> {
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
        <HypermediaPreviewPanel
          selection={selection}
          onClose={() => undefined}
          onEscape={() => undefined}
          onSelect={() => undefined}
        />
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

async function renderInteractivePreview(onEscape: () => void) {
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
    const [selection, setSelection] = useState<HypermediaSelection>(initialSelection);
    return (
      <>
        <button type="button" onClick={() => setSelection(nextSelection)}>
          Select another page
        </button>
        <HypermediaPreviewPanel
          selection={selection}
          onClose={() => undefined}
          onEscape={onEscape}
          onSelect={setSelection}
        />
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

test('preview headers use visible same-window entity links without native tooltips', async () => {
  const pageHtml = await renderPreview({ kind: 'page', readableId: 'project-brief' });
  const entityHtml = await renderPreview({ kind: 'entity', readableId: 'maya-chen' });

  expect(pageHtml).toContain('aria-label="Open knowledge page"');
  expect(pageHtml).toContain('>Open page</a>');
  expect(entityHtml).toContain('aria-label="Open entity"');
  expect(entityHtml).toContain('>Open entity</a>');
  expect(`${pageHtml}${entityHtml}`).not.toContain('title=');
  expect(`${pageHtml}${entityHtml}`).not.toContain('Open full');
});

test('page preview content keeps entity navigation inside the Hypermedia overlay', async () => {
  const pageHtml = await renderPreview({ kind: 'page', readableId: 'project-brief' });

  expect(pageHtml).toContain('>launch plan</button>');
  expect(pageHtml).toContain('href="/api/assets/rollout-metrics/content"');
  expect(pageHtml).not.toContain('href="/entities/maya-chen"');
  expect(pageHtml).not.toContain('href="/pages/launch-plan"');
  expect(pageHtml).toContain('(record unavailable)');
  expect(pageHtml).not.toContain('href="/records/research');
});

test('each selected preview receives focus and handles Escape locally', async () => {
  const user = userEvent.setup();
  let escapeCount = 0;
  await renderInteractivePreview(() => {
    escapeCount += 1;
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

  expect(escapeCount).toBe(1);
});
