import { afterEach, expect, test } from 'bun:test';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { RecordCardContent, RecordLink } from '../../src/components/records/record-link';
import type { ContextRecordSummary } from '../../src/queries/records';

afterEach(cleanup);

const record: ContextRecordSummary = {
  readableId: 'context-use-pr-57-a1b2c3',
  title: 'context-use #57: Describe records clearly',
  sourceCreatedAt: '2026-09-01T10:00:00Z',
  sourceUpdatedAt: null,
  createdAt: new Date('2026-09-09T11:00:00.000Z'),
  updatedAt: new Date('2026-09-09T12:00:00.000Z'),
  source: { provider: 'github', kind: 'pull-request', id: '57', url: null },
  occurredAt: null,
};

test('record cards identify their content, provider, and kind', () => {
  render(<RecordCardContent record={record} />);

  expect(screen.getByText(record.title)).toBeTruthy();
  expect(screen.getByText('github · pull-request')).toBeTruthy();
  expect(screen.queryByText('Not provided')).toBeNull();
  expect(document.querySelector('time')).toBeNull();
  expect(screen.queryByText(record.source.id)).toBeNull();
  expect(screen.queryByText('Synced by Example sync')).toBeNull();
});

test('record links navigate by local readable ID and expose their selected state', async () => {
  const rootRoute = createRootRoute({ component: Outlet });
  const recordRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'records/$id',
    component: () => <RecordLink record={record} active />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([recordRoute]),
    history: createMemoryHistory({
      initialEntries: [`/records/${record.readableId}?provider=github&sortBy=kind&view=metadata`],
    }),
  });
  await router.load();
  render(<RouterProvider router={router} />);

  const link = screen.getByRole('link', { name: new RegExp(record.source.kind, 'i') });
  expect(link.getAttribute('href')).toBe(
    `/records/${record.readableId}?provider=github&sortBy=kind&view=preview`,
  );
  expect(link.getAttribute('aria-current')).toBe('page');
});
