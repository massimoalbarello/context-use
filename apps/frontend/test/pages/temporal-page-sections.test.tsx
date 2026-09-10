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
    readableId: 'general-guidance',
    title: 'General guidance',
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

test('Pages presents every page in one list with intervals where present', async () => {
  const html = await renderWithRouter(<KnowledgePageList pages={pages} />);

  expect(html).toContain('Since March 2025? · ongoing');
  expect(html).toContain('Ongoing work');
  expect(html).toContain('General guidance');
});

test('Pages renders a date-only interval revived by the API transport', async () => {
  const transportedPage = {
    ...pages[0],
    readableId: 'design-critique',
    title: 'Design critique',
    temporalCoverage: new Date('2026-08-28T00:00:00.000Z'),
  } as unknown as KnowledgePageSummary;

  const html = await renderWithRouter(<KnowledgePageList pages={[transportedPage]} />);

  expect(html).toContain('title="Interval: 2026-08-28."');
  expect(html).toContain('Design critique');
});

test('entity-related pages use one list with intervals where present', async () => {
  const html = await renderWithRouter(<EntityPageSections pages={pages} />);

  expect(html).toContain('Mentioned by');
  expect(html).not.toContain('With interval');
  expect(html).not.toContain('Without interval');
  expect(html).toContain('General guidance');
  expect(html).toContain('Since March 2025? · ongoing');
});
