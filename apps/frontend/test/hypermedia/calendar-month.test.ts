import { expect, test } from 'bun:test';
import {
  calendarMonthFromRange,
  calendarMonthLabel,
  calendarMonthRange,
  mapMonthAfterScroll,
} from '../../src/lib/calendar-month';

const NOW = new Date('2026-09-10T12:00:00.000Z');

test('calendar months provide stable labels and inclusive ranges', () => {
  expect(calendarMonthLabel()).toBe('Undated');
  expect(calendarMonthLabel('2026-09')).toBe('September 2026');
  expect(calendarMonthRange('2024-02')).toEqual({
    from: '2024-02-01',
    to: '2024-02-29',
  });
  expect(calendarMonthFromRange({ from: '2025-03-15', to: '2025-04-15' })).toBe('2025-03');
});

test('Map scrolling enters the present month then moves backward and returns to undated', () => {
  expect(mapMonthAfterScroll({ direction: 'older', now: NOW })).toBe('2026-09');
  expect(mapMonthAfterScroll({ month: '2026-09', direction: 'older', now: NOW })).toBe('2026-08');
  expect(mapMonthAfterScroll({ month: '2026-08', direction: 'newer', now: NOW })).toBe('2026-09');
  expect(mapMonthAfterScroll({ month: '2026-09', direction: 'newer', now: NOW })).toBeUndefined();
});
