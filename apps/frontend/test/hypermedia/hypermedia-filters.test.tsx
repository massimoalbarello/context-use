import { afterEach, expect, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HypermediaFilters } from '../../src/components/hypermedia/hypermedia-filters';

afterEach(cleanup);

function HypermediaEntityFilterFixture() {
  return (
    <HypermediaFilters
      query=""
      selectedEntities={[]}
      onQueryApply={() => undefined}
      onClearSelectedEntities={() => undefined}
    />
  );
}

test('Hypermedia displays the current keyword and selected entities', () => {
  render(
    <HypermediaFilters
      query="launch"
      selectedEntities={[{ readableId: 'maya-chen' }, { readableId: 'rollout-metrics' }]}
      onQueryApply={() => undefined}
      onClearSelectedEntities={() => undefined}
    />,
  );

  expect(screen.queryByRole('group', { name: 'Hypermedia entity types' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Assets' })).toBeNull();
  expect(screen.getByRole('searchbox', { name: 'Keyword' }).getAttribute('value')).toBe('launch');
  expect(screen.getByText('2 entities selected')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Clear selected entities' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy();
});

test('Command K focuses the Hypermedia keyword search', () => {
  render(<HypermediaEntityFilterFixture />);
  const keyword = screen.getByRole('searchbox', { name: 'Keyword' });
  const apply = screen.getByRole('button', { name: 'Apply' });
  fireEvent.change(keyword, { target: { value: 'search' } });
  apply.focus();

  expect(document.activeElement).toBe(apply);
  expect(fireEvent.keyDown(window, { key: 'k', metaKey: true })).toBe(false);
  expect(document.activeElement).toBe(keyword);
  expect(keyword.getAttribute('aria-keyshortcuts')).toBe('Meta+K');
});
