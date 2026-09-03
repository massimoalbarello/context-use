import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { HypermediaFilters } from '../../src/components/hypermedia/hypermedia-filters';

test('Hypermedia composes explicit keyword and date range filters', () => {
  const html = renderToStaticMarkup(
    <HypermediaFilters
      query="launch"
      dateRange={{ from: '2026-01-01', to: '2026-03-31' }}
      onQueryApply={() => undefined}
      onDateRangeApply={() => undefined}
    />,
  );

  expect(html).toContain('Keyword');
  expect(html).toContain('value="launch"');
  expect(html).toContain('01/01/2026 – 31/03/2026');
  expect(html).toContain('Apply');
});
