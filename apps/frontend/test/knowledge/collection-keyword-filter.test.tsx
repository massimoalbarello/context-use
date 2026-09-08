import { afterEach, expect, mock, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CollectionKeywordFilter } from '../../src/components/knowledge/collection-keyword-filter';

afterEach(cleanup);

test('collection keyword filtering stays behind the shared filter icon', async () => {
  const onApply = mock(() => undefined);
  const user = userEvent.setup();
  render(
    <CollectionKeywordFilter
      title="Filter entities"
      query=""
      inputId="entity-keyword"
      placeholder="Entity name"
      maxLength={160}
      onApply={onApply}
    />,
  );

  const trigger = screen.getByRole('button', { name: 'Filter entities' });
  expect(trigger.textContent).toBe('');
  expect(screen.queryByRole('searchbox', { name: 'Keyword' })).toBeNull();

  await user.click(trigger);
  const keyword = screen.getByRole('searchbox', { name: 'Keyword' });
  expect(keyword.getAttribute('placeholder')).toBe('Entity name');
  await user.type(keyword, '  Maya  ');
  await user.click(screen.getByRole('button', { name: 'Apply' }));

  expect(onApply).toHaveBeenLastCalledWith('Maya');
});

test('the shared filter shortcut opens asset keyword search', async () => {
  const user = userEvent.setup();
  render(
    <CollectionKeywordFilter
      title="Filter assets"
      query=""
      inputId="asset-keyword"
      placeholder="Asset name"
      maxLength={160}
      onApply={() => undefined}
    />,
  );

  await user.keyboard('{Meta>}k{/Meta}');
  const keyword = screen.getByRole('searchbox', { name: 'Keyword' });
  expect(keyword.getAttribute('placeholder')).toBe('Asset name');
  expect(document.activeElement).toBe(keyword);
});
