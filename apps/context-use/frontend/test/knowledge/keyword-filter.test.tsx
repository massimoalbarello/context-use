import { afterEach, expect, mock, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KeywordFilter } from '../../src/components/knowledge/keyword-filter';

afterEach(cleanup);

test('collection search is always visible and trims submitted keywords', async () => {
  const onApply = mock(() => undefined);
  const user = userEvent.setup();
  render(
    <KeywordFilter
      value=""
      inputId="entity-keyword"
      placeholder="Entity name"
      maxLength={160}
      onApply={onApply}
    />,
  );

  const keyword = screen.getByRole('searchbox', { name: 'Entity name' });
  expect(keyword.getAttribute('placeholder')).toBe('Entity name');
  await user.type(keyword, '  Maya  ');
  await user.click(screen.getByRole('button', { name: 'Search' }));

  expect(onApply).toHaveBeenLastCalledWith('Maya');
});

test('Command K focuses visible resource search', async () => {
  const user = userEvent.setup();
  render(
    <KeywordFilter
      value=""
      inputId="asset-keyword"
      placeholder="Asset name"
      maxLength={160}
      onApply={() => undefined}
    />,
  );

  await user.keyboard('{Meta>}k{/Meta}');
  const keyword = screen.getByRole('searchbox', { name: 'Asset name' });
  expect(keyword.getAttribute('placeholder')).toBe('Asset name');
  expect(document.activeElement).toBe(keyword);

  await user.type(keyword, 'iPhone');
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Search' }));
  await user.keyboard('{Meta>}k{/Meta}');
  expect(document.activeElement).toBe(keyword);
  expect((keyword as HTMLInputElement).selectionStart).toBe(0);
  expect((keyword as HTMLInputElement).selectionEnd).toBe('iPhone'.length);
});
