import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { HypermediaTimeRange } from '../../src/components/hypermedia/hypermedia-time-range';
import {
  calendarDateFromEpochDay,
  epochDayFromCalendarDate,
} from '../../src/lib/temporal-coverage';

test('calendar dates round-trip through UTC epoch days', () => {
  expect(calendarDateFromEpochDay(epochDayFromCalendarDate('2026-03-29'))).toBe('2026-03-29');
});

test('renders an accessible range slider above the Hypermedia canvas', () => {
  const html = renderToStaticMarkup(
    <HypermediaTimeRange
      value={{ from: '2025-03-01', to: '2026-03-31' }}
      extent={{
        start: Date.parse('2024-01-01T00:00:00.000Z'),
        end: Date.parse('2026-12-31T00:00:00.000Z'),
      }}
      hasMore={false}
      loading={false}
      error={null}
      onApply={() => undefined}
      onRetry={() => undefined}
    />,
  );

  expect(html).toContain('Time range');
  expect(html).toContain('1 Mar 2025 – 31 Mar 2026');
  expect(html).toContain('aria-label="Start date"');
  expect(html).toContain('aria-label="End date"');
  expect(html).toContain('All time');
});

test('shows a density warning when the bounded page view is incomplete', () => {
  const html = renderToStaticMarkup(
    <HypermediaTimeRange
      extent={null}
      hasMore
      loading={false}
      error={null}
      onApply={() => undefined}
      onRetry={() => undefined}
    />,
  );

  expect(html).toContain('This view is too dense. Select entities or narrow the time range.');
});
