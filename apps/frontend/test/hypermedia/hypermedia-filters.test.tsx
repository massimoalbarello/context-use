import { afterEach, expect, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HypermediaFilters } from '../../src/components/hypermedia/hypermedia-filters';
import {
  type HypermediaResourceKind,
  toggleDisplayedHypermediaResourceKind,
} from '../../src/components/hypermedia/hypermedia-resource-filter';

afterEach(cleanup);

function HypermediaResourceFilterFixture() {
  const [resourceKinds, setResourceKinds] = useState<HypermediaResourceKind[]>(['entity']);
  return (
    <HypermediaFilters
      projection="semantic"
      resourceKinds={resourceKinds}
      query=""
      selectedResources={[]}
      onProjectionChange={() => undefined}
      onResourceKindToggle={(kind) => {
        setResourceKinds((current) =>
          toggleDisplayedHypermediaResourceKind({ kinds: current, kind }),
        );
      }}
      onQueryApply={() => undefined}
      onClearSelectedResources={() => undefined}
    />
  );
}

test('Hypermedia keeps projection, keyword, and resource filters in the shared sidebar', () => {
  const html = renderToStaticMarkup(
    <HypermediaFilters
      projection="temporal"
      resourceKinds={['entity']}
      query="launch"
      selectedResources={[
        { kind: 'entity', readableId: 'maya-chen' },
        { kind: 'asset', readableId: 'rollout-metrics' },
      ]}
      onProjectionChange={() => undefined}
      onResourceKindToggle={() => undefined}
      onQueryApply={() => undefined}
      onClearSelectedResources={() => undefined}
    />,
  );

  expect(html).toContain('aria-label="Hypermedia projection"');
  expect(html).toContain('Semantic');
  expect(html).toContain('Temporal');
  expect(html).toContain('Visualize');
  expect(html).toContain('Entities');
  expect(html).toContain('Assets');
  expect(html).toContain('aria-label="Hypermedia resource types"');
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain('aria-pressed="false"');
  expect(html.indexOf('Semantic')).toBeGreaterThan(html.indexOf('Filter hypermedia'));
  expect(html.indexOf('Visualize')).toBeGreaterThan(html.indexOf('Temporal'));
  expect(html).toContain('Keyword');
  expect(html.indexOf('Keyword')).toBeGreaterThan(html.indexOf('Assets'));
  expect(html).toContain('value="launch"');
  expect(html).not.toContain('Time range');
  expect(html).toContain('2 resources selected');
  expect(html).toContain('Pages include every selection.');
  expect(html).toContain('aria-label="Clear selected resources"');
  expect(html.indexOf('2 resources selected')).toBeGreaterThan(html.indexOf('Keyword'));
  expect(html).toContain('Apply');
});

test('Hypermedia resource type buttons select either type or both', async () => {
  const user = userEvent.setup();
  render(<HypermediaResourceFilterFixture />);
  const entities = screen.getByRole('button', { name: 'Entities' });
  const assets = screen.getByRole('button', { name: 'Assets' });

  expect(entities.getAttribute('aria-pressed')).toBe('true');
  expect(assets.getAttribute('aria-pressed')).toBe('false');

  await user.click(assets);
  expect(entities.getAttribute('aria-pressed')).toBe('true');
  expect(assets.getAttribute('aria-pressed')).toBe('true');

  await user.click(entities);
  expect(entities.getAttribute('aria-pressed')).toBe('false');
  expect(assets.getAttribute('aria-pressed')).toBe('true');

  await user.click(assets);
  expect(assets.getAttribute('aria-pressed')).toBe('true');
});

test('Command K focuses the Hypermedia keyword search', () => {
  render(<HypermediaResourceFilterFixture />);
  const keyword = screen.getByRole('searchbox', { name: 'Keyword' });
  const entities = screen.getByRole('button', { name: 'Entities' });
  entities.focus();

  expect(document.activeElement).toBe(entities);
  expect(fireEvent.keyDown(window, { key: 'k', metaKey: true })).toBe(false);
  expect(document.activeElement).toBe(keyword);
  expect(keyword.getAttribute('aria-keyshortcuts')).toBe('Meta+K');
});
