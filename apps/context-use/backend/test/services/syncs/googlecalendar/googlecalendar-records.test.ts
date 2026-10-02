import { expect, test } from 'bun:test';
import {
  eventRecord,
  providerEventSchema,
} from '#backend/services/syncs/sources/googlecalendar/records.ts';
import { created, event } from './googlecalendar-fixture.ts';

test('Calendar event content preserves time zones, participants, HTML descriptions and upstream timestamps', () => {
  const record = eventRecord({
    calendarId: 'a',
    timeZone: 'Europe/London',
    event: providerEventSchema.parse({
      ...event('one'),
      description: '<p>Discuss <strong>the plan</strong></p><ul><li>Next step</li></ul>',
    }),
  });
  expect(record).toMatchObject({
    id: '["a","one"]',
    createdAt: created,
    updatedAt: created,
    data: {
      title: 'Event one',
      sourceOccurredAt: '2026-10-01T09:00:00+01:00',
      start: { dateTime: '2026-10-01T09:00:00+01:00', timeZone: 'Europe/London' },
      participants: [{ email: 'guest@example.com', responseStatus: 'accepted' }],
      recurrence: ['RRULE:FREQ=WEEKLY'],
    },
  });
  if (record.operation !== 'upsert') {
    throw new Error('Expected event');
  }
  expect(record.content?.body).toContain('Guest — guest@example.com (accepted)');
  expect(record.content?.body).toContain('Discuss **the plan**');
  expect(record.content?.body).toContain('Location: Meeting room');
  expect(record.content?.body).toContain('Organizer: owner@example.com');
});

test('Cancelled exceptions and all-day events retain date semantics without inventing times', () => {
  const record = eventRecord({
    calendarId: 'a',
    event: providerEventSchema.parse({
      id: 'exception',
      status: 'cancelled',
      recurringEventId: 'series',
      originalStartTime: { date: '2026-10-01' },
    }),
  });
  expect(record).toMatchObject({
    data: {
      status: 'cancelled',
      recurringEventId: 'series',
      originalStartTime: { date: '2026-10-01' },
      start: null,
      sourceOccurredAt: null,
    },
    id: '["a","exception"]',
  });
  const allDay = eventRecord({
    calendarId: 'a',
    event: providerEventSchema.parse({
      ...event('one'),
      start: { date: '2026-10-01' },
      end: { date: '2026-10-02' },
    }),
  });
  if (allDay.operation !== 'upsert') {
    throw new Error('Expected event');
  }
  expect(allDay.content?.body).toContain('Start: 2026-10-01 (all day)');
  expect(allDay.data.sourceOccurredAt).toBe('2026-10-01');
  expect(allDay.content?.body).toContain(
    'End (exclusive for all-day events): 2026-10-02 (all day)',
  );
});

test('a moved recurring event uses its current start rather than its original start', () => {
  const record = eventRecord({
    calendarId: 'a',
    event: providerEventSchema.parse({
      ...event('one'),
      recurringEventId: 'series',
      originalStartTime: { dateTime: '2026-09-24T09:00:00+01:00' },
    }),
  });
  expect(record).toMatchObject({ data: { sourceOccurredAt: '2026-10-01T09:00:00+01:00' } });
});
