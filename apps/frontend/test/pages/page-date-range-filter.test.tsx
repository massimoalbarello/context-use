import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  calendarValueFromDate,
  dateRangeButtonLabel,
  PageDateRangeFilter,
} from '../../src/components/pages/page-date-range-filter';

test('date filtering uses one app-owned range trigger instead of native date inputs', () => {
  const html = renderToStaticMarkup(<PageDateRangeFilter onApply={() => undefined} />);

  expect(html).toContain('Choose dates');
  expect(html).toContain('General knowledge stays visible.');
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).not.toContain('type="date"');
});

test('calendar selections produce stable URL dates and a concise range label', () => {
  const marchFirst = new Date('2025-03-01T12:00:00');
  expect(calendarValueFromDate(marchFirst)).toBe('2025-03-01');
  expect(dateRangeButtonLabel({ from: '2025-03-01', to: '2025-08-31' })).toBe(
    '01/03/2025 – 31/08/2025',
  );
  expect(dateRangeButtonLabel({ from: '2025-12-31', to: '2026-01-01' })).toBe(
    '31/12/2025 – 01/01/2026',
  );
});
