import { afterEach, expect, test } from 'bun:test';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { KnowledgePageLink } from '../../src/components/pages/knowledge-page-link';

afterEach(cleanup);

test('page cards outside a browser link directly to the canonical detail preview', async () => {
  const root = createRootRoute({
    component: () => (
      <KnowledgePageLink
        page={{
          readableId: 'target-page',
          title: 'Target page',
          excerpt: 'Summary',
          temporalCoverage: null,
        }}
        presentation="card"
        active
      />
    ),
  });
  const index = createRoute({ getParentRoute: () => root, path: '/' });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  const link = screen.getByRole('link', { name: 'Target page Summary' });
  expect(link.getAttribute('href')).toBe('/pages/target-page?view=preview');
  expect(link.getAttribute('aria-current')).toBe('page');
});
