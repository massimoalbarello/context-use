import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { HypermediaFilters } from '../../src/components/hypermedia/hypermedia-filters';

test('Hypermedia keeps keyword and resource filters in the shared sidebar', () => {
  const html = renderToStaticMarkup(
    <HypermediaFilters
      query="launch"
      selectedResources={[
        { kind: 'entity', readableId: 'maya-chen' },
        { kind: 'asset', readableId: 'rollout-metrics' },
      ]}
      onQueryApply={() => undefined}
      onClearSelectedResources={() => undefined}
    />,
  );

  expect(html).toContain('Keyword');
  expect(html).toContain('value="launch"');
  expect(html).not.toContain('Time range');
  expect(html).toContain('2 resources selected');
  expect(html).toContain('Pages include every selection.');
  expect(html).toContain('aria-label="Clear selected resources"');
  expect(html.indexOf('2 resources selected')).toBeGreaterThan(html.indexOf('Keyword'));
  expect(html).toContain('Apply');
});
