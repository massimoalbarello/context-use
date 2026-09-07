import { afterEach, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { HypermediaLayoutResource } from '../../src/components/hypermedia/hypermedia-layout';
import type { HypermediaSelection } from '../../src/components/hypermedia/hypermedia-selection';
import { HypermediaTemporalCanvas } from '../../src/components/hypermedia/hypermedia-temporal-canvas';
import { KnowledgeWorkspace } from '../../src/components/knowledge/knowledge-workspace';
import type { HypermediaPage } from '../../src/queries/hypermedia';

afterEach(cleanup);

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const PAGE_DISCOVERY_SCROLL_TOP = 10_000;
const OVERLAP_NOTE = 'Overlapping clouds mark pages on the same or nearby dates';
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
const continuedPage: HypermediaPage = {
  ...temporalPage,
  readableId: 'earlier-period',
  title: 'Earlier period',
  temporalCoverage: '2024-03/2024-08',
};

function TemporalPaginationFixture({
  onSelect,
}: {
  onSelect: (selection: HypermediaSelection) => void;
}) {
  const [continued, setContinued] = useState(false);
  return (
    <KnowledgeWorkspace>
      <div />
      <HypermediaTemporalCanvas
        resources={[self]}
        pages={continued ? [temporalPage, continuedPage] : [temporalPage]}
        extent={{
          start: Date.parse('2024-01-01T00:00:00.000Z'),
          end: Date.parse('2026-12-31T00:00:00.000Z'),
        }}
        selectedResources={[{ kind: 'entity', readableId: 'self' }]}
        onSelect={onSelect}
        onDateRangeApply={() => undefined}
        onViewportSettled={() => undefined}
        hasNextPage={!continued}
        isFetchingNextPage={false}
        onDiscoverMorePages={() => setContinued(true)}
      />
    </KnowledgeWorkspace>
  );
}

test('temporal canvas keeps resource filtering and page preview selection accessible', async () => {
  const onSelect = mock(() => undefined);
  const user = userEvent.setup();
  render(<TemporalPaginationFixture onSelect={onSelect} />);

  const entityButton = screen.getByRole('button', { name: /Self Entity/ });
  expect(entityButton.getAttribute('aria-pressed')).toBe('true');
  await user.click(entityButton);
  expect(onSelect).toHaveBeenLastCalledWith({ kind: 'entity', readableId: 'self' });

  const scroller = screen.getByRole('region', { name: 'Temporal timeline viewport' });
  scroller.scrollTop = PAGE_DISCOVERY_SCROLL_TOP;
  fireEvent.scroll(scroller);
  expect(
    screen.getByRole('link', { name: 'Open temporal knowledge page Earlier period' }),
  ).toBeTruthy();

  const pageLink = screen.getByRole('link', {
    name: 'Open temporal knowledge page Launch period',
  });
  await user.hover(pageLink);
  expect(screen.getByText('A temporal page.')).toBeTruthy();
  await user.click(pageLink);
  expect(onSelect).toHaveBeenLastCalledWith({ kind: 'page', readableId: 'launch-period' });
  expect(screen.queryByText('Scroll through time')).toBeNull();
  expect(screen.queryByText('Entities and assets')).toBeNull();
  expect(screen.queryByRole('note', { name: OVERLAP_NOTE })).toBeNull();
});

test('temporal canvas explains unavoidable page overlap', () => {
  const overlappingPages = ['first-page', 'second-page'].map(
    (readableId): HypermediaPage => ({
      ...temporalPage,
      readableId,
      title: readableId,
      temporalCoverage: '2025-08-25',
    }),
  );

  render(
    <KnowledgeWorkspace>
      <div />
      <HypermediaTemporalCanvas
        resources={[self]}
        pages={overlappingPages}
        extent={{
          start: Date.parse('2025-01-01T00:00:00.000Z'),
          end: Date.parse('2025-12-31T00:00:00.000Z'),
        }}
        selectedResources={[]}
        onSelect={() => undefined}
        onDateRangeApply={() => undefined}
        onViewportSettled={() => undefined}
        hasNextPage={false}
        isFetchingNextPage={false}
        onDiscoverMorePages={() => undefined}
      />
    </KnowledgeWorkspace>,
  );

  expect(screen.getByRole('note', { name: OVERLAP_NOTE })).toBeTruthy();
});
