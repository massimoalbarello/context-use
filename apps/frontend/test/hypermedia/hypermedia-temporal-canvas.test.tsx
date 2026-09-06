import { afterEach, expect, mock, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HypermediaLayoutResource } from '../../src/components/hypermedia/hypermedia-layout';
import { HypermediaTemporalCanvas } from '../../src/components/hypermedia/hypermedia-temporal-canvas';
import type { HypermediaPage } from '../../src/queries/hypermedia';

afterEach(cleanup);

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const self: HypermediaLayoutResource = {
  key: 'entity:self',
  kind: 'entity',
  entity: {
    readableId: 'self',
    name: 'Self Entity',
    description: 'The owner.',
    isSelf: true,
    image: null,
    createdAt,
    updatedAt: createdAt,
  },
  point: { x: 0, y: 0 },
};
const temporalPage: HypermediaPage = {
  readableId: 'launch-period',
  title: 'Launch period',
  excerpt: 'A temporal page.',
  temporalCoverage: '2025-03/2025-08',
  revisionNumber: 1,
  createdAt,
  updatedAt: createdAt,
  resources: [{ kind: 'entity', readableId: 'self' }],
};

test('temporal canvas keeps resource filtering and page preview selection accessible', async () => {
  const onSelect = mock(() => undefined);
  const user = userEvent.setup();
  render(
    <HypermediaTemporalCanvas
      resources={[self]}
      pages={[temporalPage]}
      extent={{
        start: Date.parse('2024-01-01T00:00:00.000Z'),
        end: Date.parse('2026-12-31T00:00:00.000Z'),
      }}
      selectedResources={[{ kind: 'entity', readableId: 'self' }]}
      selectedKey="page:launch-period"
      onSelect={onSelect}
      onDateRangeApply={() => undefined}
      onViewportSettled={() => undefined}
    />,
  );

  const entityButton = screen.getByRole('button', { name: /Self Entity/ });
  expect(entityButton.getAttribute('aria-pressed')).toBe('true');
  await user.click(entityButton);
  expect(onSelect).toHaveBeenLastCalledWith({ kind: 'entity', readableId: 'self' });

  await user.click(
    screen.getByRole('link', { name: 'Open temporal knowledge page Launch period' }),
  );
  expect(onSelect).toHaveBeenLastCalledWith({ kind: 'page', readableId: 'launch-period' });
  expect(screen.queryByText('Scroll through time')).toBeNull();
  expect(screen.queryByText('Entities and assets')).toBeNull();
});
