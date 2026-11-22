import { afterEach, expect, test } from 'bun:test';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import {
  KnowledgePageCardContent,
  KnowledgePageLink,
} from '../../src/components/pages/knowledge-page-link';

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
  expect(link.getAttribute('href')).toBe('/app/pages/target-page?view=preview');
  expect(link.getAttribute('aria-current')).toBe('page');
});

for (const state of [
  { name: 'private', publishedAt: null, publishedRevisionNumber: null, warning: false },
  {
    name: 'current public',
    publishedAt: '2026-01-01T00:00:00Z',
    publishedRevisionNumber: 2,
    warning: false,
  },
  {
    name: 'public with an unpublished latest revision',
    publishedAt: '2026-01-01T00:00:00Z',
    publishedRevisionNumber: 1,
    warning: true,
  },
]) {
  test(`page card shows publication tags for a ${state.name} page`, () => {
    render(
      <KnowledgePageCardContent
        page={{
          readableId: 'target-page',
          title: 'Target page',
          excerpt: 'Summary',
          temporalCoverage: null,
          revisionNumber: 2,
          publishedAt: state.publishedAt,
          publishedRevisionNumber: state.publishedRevisionNumber,
        }}
      />,
    );
    expect(screen.queryByText('Unpublished revisions') !== null).toBe(state.warning);
    expect(screen.queryByText('Public') !== null).toBe(
      state.publishedAt !== null && !state.warning,
    );
  });
}
