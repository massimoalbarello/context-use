import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { HypermediaFilters } from '../../src/components/hypermedia/hypermedia-filters';

test('Hypermedia composes resource, keyword, and time filters in sidebar order', () => {
  const html = renderToStaticMarkup(
    <HypermediaFilters
      query="launch"
      dateRange={{ from: '2026-01-01', to: '2026-03-31' }}
      temporalExtent={{
        start: Date.parse('2025-01-01T00:00:00.000Z'),
        end: Date.parse('2026-12-31T00:00:00.000Z'),
      }}
      hasMorePages={false}
      pagesLoading={false}
      pagesError={null}
      selectedResources={[
        { kind: 'entity', readableId: 'maya-chen' },
        { kind: 'asset', readableId: 'rollout-metrics' },
      ]}
      onQueryApply={() => undefined}
      onDateRangeApply={() => undefined}
      onRetryPages={() => undefined}
      onClearSelectedResources={() => undefined}
    />,
  );

  expect(html).toContain('Keyword');
  expect(html).toContain('value="launch"');
  expect(html).toContain('Time range');
  expect(html).toContain('2 resources selected');
  expect(html).toContain('Pages include every selection.');
  expect(html).toContain('aria-label="Clear selected resources"');
  expect(html.indexOf('2 resources selected')).toBeGreaterThan(html.indexOf('Time range'));
  expect(html).toContain('Apply');
});
