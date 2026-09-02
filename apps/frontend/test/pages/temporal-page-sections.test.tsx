import { expect, test } from 'bun:test';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EntityPageSections } from '../../src/components/entities/entity-page-sections';
import { KnowledgePageList } from '../../src/components/pages/knowledge-page-list';
import type { KnowledgePageSummary } from '../../src/queries/pages';

const timestamp = new Date('2026-09-02T12:00:00.000Z');
const pages = [
  {
    readableId: 'ongoing-work',
    title: 'Ongoing work',
    excerpt: 'Still evidenced.',
    temporalCoverage: '2025-03?/..',
    revisionNumber: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    readableId: 'semantic-guidance',
    title: 'Semantic guidance',
    excerpt: 'No single time asserted.',
    temporalCoverage: null,
    revisionNumber: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
] satisfies KnowledgePageSummary[];

async function renderWithRouter(content: ReactNode): Promise<string> {
  const rootRoute = createRootRoute({ component: () => content });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/' });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

test('Pages presents semantic and temporal pages in one list with intervals where present', async () => {
  const html = await renderWithRouter(<KnowledgePageList pages={pages} />);

  expect(html).toContain('Since March 2025? · ongoing');
  expect(html).toContain('Ongoing work');
  expect(html).toContain('Semantic guidance');
  expect(html).not.toContain('General knowledge');
});

test('entity-related pages use Temporal and Semantic sections', async () => {
  const html = await renderWithRouter(<EntityPageSections pages={pages} />);

  expect(html).toContain('Mentioned by');
  expect(html).toContain('Temporal');
  expect(html).toContain('Semantic');
  expect(html).not.toContain('Timeline');
  expect(html).not.toContain('General knowledge');
  expect(html).toContain('Since March 2025? · ongoing');
});
