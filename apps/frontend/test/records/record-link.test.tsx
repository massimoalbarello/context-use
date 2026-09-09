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
  title: 'massimoalbarello/context-use #57: Receive external records',
  excerpt: 'Context Use accepts a durable batch of Markdown records.',
  externalService: { id: 'open-connector', name: 'Open Connector' },
  createdAt: new Date('2026-09-09T11:00:00.000Z'),
  updatedAt: new Date('2026-09-09T12:00:00.000Z'),
};

test('record cards identify their content and syncing external service', () => {
  render(<RecordCardContent record={record} />);

  expect(screen.getByText(record.title)).toBeTruthy();
  expect(screen.getByText(record.excerpt)).toBeTruthy();
  expect(screen.getByText('Synced by Open Connector')).toBeTruthy();
  expect(screen.queryByText(record.externalService.id)).toBeNull();
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
    history: createMemoryHistory({ initialEntries: [`/records/${record.readableId}`] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);

  const link = screen.getByRole('link', { name: new RegExp(record.title, 'i') });
  expect(link.getAttribute('href')).toBe(`/records/${record.readableId}`);
  expect(link.getAttribute('aria-current')).toBe('page');
});
