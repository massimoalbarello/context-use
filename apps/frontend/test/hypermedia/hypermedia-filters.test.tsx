import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { HypermediaFilters } from '../../src/components/hypermedia/hypermedia-filters';

test('Hypermedia composes explicit resource, keyword, and date range filters', () => {
  const html = renderToStaticMarkup(
    <HypermediaFilters
      query="launch"
      dateRange={{ from: '2026-01-01', to: '2026-03-31' }}
      selectedResources={[
        { kind: 'entity', readableId: 'maya-chen' },
        { kind: 'asset', readableId: 'rollout-metrics' },
      ]}
      onQueryApply={() => undefined}
      onDateRangeApply={() => undefined}
      onClearSelectedResources={() => undefined}
    />,
  );

  expect(html).toContain('Keyword');
  expect(html).toContain('value="launch"');
  expect(html).toContain('01/01/2026 – 31/03/2026');
  expect(html).toContain('2 resources selected');
  expect(html).toContain('Pages include every selection.');
  expect(html).toContain('aria-label="Clear selected resources"');
  expect(html).toContain('Apply');
});
