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
import { type Asset, assetPreviewQueryOptions } from '../../src/queries/assets';
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
  if (selection.kind === 'asset') {
    const timestamp = new Date('2026-01-01T00:00:00.000Z');
    const launchPage = {
      readableId: 'launch-readiness-plan',
      title: 'Launch readiness plan',
      excerpt: 'Prepare the wider rollout.',
      temporalCoverage: null,
      revisionNumber: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    queryClient.setQueryData(assetPreviewQueryOptions(selection.readableId).queryKey, {
      readableId: selection.readableId,
      name: 'Rollout metrics',
      mediaType: 'application/octet-stream',
      extension: null,
      sizeBytes: 105,
      createdAt: timestamp,
      updatedAt: timestamp,
      usages: [
        { kind: 'page', presentation: 'embed', page: launchPage },
        { kind: 'page', presentation: 'attachment', page: launchPage },
        {
          kind: 'page',
          presentation: 'attachment',
          page: { ...launchPage, readableId: 'decision-log', title: 'Decision log' },
        },
      ],
    } as Asset);
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

test('preview headers use visible same-window resource links without native tooltips', async () => {
  const pageHtml = await renderPreview({ kind: 'page', readableId: 'project-brief' });
  const entityHtml = await renderPreview({ kind: 'entity', readableId: 'maya-chen' });
  const assetHtml = await renderPreview({ kind: 'asset', readableId: 'rollout-metrics' });

  expect(pageHtml).toContain('aria-label="Open knowledge page"');
  expect(pageHtml).toContain('>Open page</a>');
  expect(entityHtml).toContain('aria-label="Open entity"');
  expect(entityHtml).toContain('>Open entity</a>');
  expect(assetHtml).toContain('aria-label="Open asset"');
  expect(assetHtml).toContain('>Open asset</a>');
  expect(`${pageHtml}${entityHtml}${assetHtml}`).not.toContain('title=');
  expect(`${pageHtml}${entityHtml}${assetHtml}`).not.toContain('Open full');
});

test('page preview content keeps resource navigation inside the Hypermedia overlay', async () => {
  const pageHtml = await renderPreview({ kind: 'page', readableId: 'project-brief' });

  expect(pageHtml).toContain('>launch plan</button>');
  expect(pageHtml).toContain('>metrics</button>');
  expect(pageHtml).not.toContain('href="/entities/maya-chen"');
  expect(pageHtml).not.toContain('href="/pages/launch-plan"');
  expect(pageHtml).not.toContain('href="/api/assets/rollout-metrics/content"');
  expect(pageHtml).toContain('(record unavailable)');
  expect(pageHtml).not.toContain('href="/records/research');
});

test('asset previews show each knowledge page that embeds or attaches the asset', async () => {
  const assetHtml = await renderPreview({ kind: 'asset', readableId: 'rollout-metrics' });

  expect(assetHtml).toContain('Used by knowledge pages');
  expect(assetHtml).toContain('Launch readiness plan');
  expect(assetHtml).toContain('Embedded · Attached');
  expect(assetHtml).toContain('Decision log');
  expect(assetHtml).toContain('Attached');
  expect(assetHtml).not.toContain('href="/pages/launch-readiness-plan"');
  expect(assetHtml).not.toContain('href="/pages/decision-log"');
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
