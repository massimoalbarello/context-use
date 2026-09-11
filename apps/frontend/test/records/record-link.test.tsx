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
import type { ExternalRecordSummary } from '../../src/queries/records';

afterEach(cleanup);

const record: ExternalRecordSummary = {
  readableId: 'context-use-pr-57-a1b2c3',
  title: 'context-use #57: Describe records clearly',
  provider: 'github',
  sourceCreatedAt: '2026-09-01T10:00:00Z',
  sourceUpdatedAt: null,
  kind: 'pull-request',
  recordId: '57',
  sync: { readableId: 'example-sync-a1b2c3', name: 'Example sync' },
  createdAt: new Date('2026-09-09T11:00:00.000Z'),
  updatedAt: new Date('2026-09-09T12:00:00.000Z'),
};

test('record cards identify their content and syncing external service', () => {
  render(<RecordCardContent record={record} />);

  expect(screen.getByText(record.title)).toBeTruthy();
  expect(screen.getByText('github · pull-request')).toBeTruthy();
  expect(screen.getByText('Not provided')).toBeTruthy();
  expect(document.querySelector('time')?.getAttribute('datetime')).toBe('2026-09-01T10:00:00.000Z');
  expect(screen.queryByText(record.recordId)).toBeNull();
  expect(screen.getByText('Synced by Example sync')).toBeTruthy();
  expect(screen.queryByText(record.sync.readableId)).toBeNull();
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
      initialEntries: [`/records/${record.readableId}?provider=github&sortBy=kind`],
    }),
  });
  await router.load();
  render(<RouterProvider router={router} />);

  const link = screen.getByRole('link', { name: new RegExp(record.kind, 'i') });
  expect(link.getAttribute('href')).toBe(
    `/records/${record.readableId}?provider=github&sortBy=kind`,
  );
  expect(link.getAttribute('aria-current')).toBe('page');
});
