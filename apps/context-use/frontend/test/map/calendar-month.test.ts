import { expect, test } from 'bun:test';
import { mapMonthAfterScroll } from '../../src/lib/calendar-month';

const NOW = new Date('2026-09-10T12:00:00.000Z');

test('Map scrolling enters the present month then moves backward and returns to undated', () => {
  expect(mapMonthAfterScroll({ direction: 'older', now: NOW })).toBe('2026-09');
  expect(mapMonthAfterScroll({ month: '2026-09', direction: 'older', now: NOW })).toBe('2026-08');
  expect(mapMonthAfterScroll({ month: '2026-08', direction: 'newer', now: NOW })).toBe('2026-09');
  expect(mapMonthAfterScroll({ month: '2026-09', direction: 'newer', now: NOW })).toBeUndefined();
});
