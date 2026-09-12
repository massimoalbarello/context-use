import { afterEach, expect, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
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
      resourceKinds={resourceKinds}
      query=""
      selectedResources={[]}
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

test('Hypermedia keeps keyword and resource filters without a view selector', () => {
  render(
    <HypermediaFilters
      resourceKinds={['entity']}
      query="launch"
      selectedResources={[
        { kind: 'entity', readableId: 'maya-chen' },
        { kind: 'asset', readableId: 'rollout-metrics' },
      ]}
      onResourceKindToggle={() => undefined}
      onQueryApply={() => undefined}
      onClearSelectedResources={() => undefined}
    />,
  );

  expect(screen.queryByRole('tablist')).toBeNull();
  expect(screen.getByRole('group', { name: 'Hypermedia resource types' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Entities' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(screen.getByRole('button', { name: 'Assets' }).getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByRole('searchbox', { name: 'Keyword' }).getAttribute('value')).toBe('launch');
  expect(screen.getByText('2 resources selected')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Clear selected resources' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy();
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
