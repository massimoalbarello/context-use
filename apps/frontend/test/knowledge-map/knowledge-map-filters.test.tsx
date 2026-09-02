import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { KnowledgeMapFilters } from '../../src/components/knowledge-map/knowledge-map-filters';

test('the map composes explicit keyword and interval filters', () => {
  const html = renderToStaticMarkup(
    <KnowledgeMapFilters
      query="launch"
      dateRange={{ from: '2026-01-01', to: '2026-03-31' }}
      onQueryApply={() => undefined}
      onDateRangeApply={() => undefined}
    />,
  );

  expect(html).toContain('Filter map');
  expect(html).toContain('Keyword');
  expect(html).toContain('value="launch"');
  expect(html).toContain('Interval');
  expect(html).toContain('01/01/2026 – 31/03/2026');
  expect(html).toContain('Apply');
  expect(html).not.toContain('Find in map');
});
