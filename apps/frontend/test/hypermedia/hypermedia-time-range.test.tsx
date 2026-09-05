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

test('renders a compact sidebar trigger with the applied time range', () => {
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
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).not.toContain('Start date');
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
