import { expect, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { renderToStaticMarkup } from 'react-dom/server';
import type { KnowledgeMapSelection } from '../../src/components/knowledge-map/knowledge-map-canvas';
import { KnowledgeMapPreviewPanel } from '../../src/components/knowledge-map/knowledge-map-preview-panel';

async function renderPreview(selection: KnowledgeMapSelection): Promise<string> {
  const queryClient = new QueryClient();
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <KnowledgeMapPreviewPanel
          selection={selection}
          onClose={() => undefined}
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
