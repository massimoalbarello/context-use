import { afterEach, expect, mock, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HypermediaFilters } from '../../src/components/hypermedia/hypermedia-filters';

afterEach(cleanup);

test('Hypermedia displays selected entities and lets the user clear them', async () => {
  const onClear = mock(() => undefined);
  render(
    <HypermediaFilters
      selectedEntities={[{ readableId: 'maya-chen' }, { readableId: 'rollout-metrics' }]}
      onClearSelectedEntities={onClear}
    />,
  );

  expect(screen.getByText('2 entities selected')).toBeTruthy();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Clear selected entities' }));
  expect(onClear).toHaveBeenCalledTimes(1);
});
