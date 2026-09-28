import { expect, test } from 'bun:test';
import {
  calendarDateRangeFromSelection,
  calendarValueFromDate,
  dateRangeButtonLabel,
} from '../../src/components/knowledge/date-range-filter';

test('calendar selections produce stable URL dates and a concise range label', () => {
  const marchFirst = new Date('2025-03-01T12:00:00');
  const augustLast = new Date('2025-08-31T12:00:00');
  expect(calendarValueFromDate(marchFirst)).toBe('2025-03-01');
  expect(calendarDateRangeFromSelection({ from: marchFirst })).toEqual({
    from: '2025-03-01',
    to: '2025-03-01',
  });
  expect(calendarDateRangeFromSelection({ from: marchFirst, to: augustLast })).toEqual({
    from: '2025-03-01',
    to: '2025-08-31',
  });
  expect(dateRangeButtonLabel({ from: '2025-03-01', to: '2025-08-31' })).toBe(
    '01/03/2025 – 31/08/2025',
  );
  expect(dateRangeButtonLabel({ from: '2025-12-31', to: '2026-01-01' })).toBe(
    '31/12/2025 – 01/01/2026',
  );
});
