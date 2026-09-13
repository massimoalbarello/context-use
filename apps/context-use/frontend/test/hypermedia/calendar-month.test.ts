import { expect, test } from 'bun:test';
import { calendarMonthLabel, mapMonthAfterScroll } from '../../src/lib/calendar-month';

const NOW = new Date('2026-09-10T12:00:00.000Z');

test('calendar months provide stable labels', () => {
  expect(calendarMonthLabel()).toBe('Undated');
  expect(calendarMonthLabel('2026-09')).toBe('September 2026');
});

test('Map scrolling enters the present month then moves backward and returns to undated', () => {
  expect(mapMonthAfterScroll({ direction: 'older', now: NOW })).toBe('2026-09');
  expect(mapMonthAfterScroll({ month: '2026-09', direction: 'older', now: NOW })).toBe('2026-08');
  expect(mapMonthAfterScroll({ month: '2026-08', direction: 'newer', now: NOW })).toBe('2026-09');
  expect(mapMonthAfterScroll({ month: '2026-09', direction: 'newer', now: NOW })).toBeUndefined();
});
