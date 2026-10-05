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
  expect(record.content?.body).toContain('Start: 1 Oct 2026 at 09:00 (UTC+01:00)');
  expect(record.content?.body).toContain('End: 1 Oct 2026 at 10:00 (UTC+01:00)');
  expect(record.content?.body).not.toContain('inclusive');
  expect(record.content?.body).not.toContain('exclusive');
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
  if (record.operation !== 'upsert') {
    throw new Error('Expected event');
  }
  expect(record.content?.body).toContain('End: Unavailable');
  expect(record.content?.body).toContain('Original start: 1 Oct 2026 (all day)');
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
  expect(allDay.content?.body).toContain('Start: 1 Oct 2026 (all day)');
  expect(allDay.data.sourceOccurredAt).toBe('2026-10-01');
  expect(allDay.content?.body).toContain('End (inclusive): 1 Oct 2026 (all day)');
});

test.each([
  { start: '2026-04-28', end: '2026-05-01', inclusiveEnd: '30 Apr 2026' },
  { start: '2026-12-30', end: '2027-01-01', inclusiveEnd: '31 Dec 2026' },
  { start: '2028-02-28', end: '2028-03-01', inclusiveEnd: '29 Feb 2028' },
])(
  'all-day range $start to $end displays its last included date',
  ({ start, end, inclusiveEnd }) => {
    const record = eventRecord({
      calendarId: 'a',
      event: providerEventSchema.parse({
        ...event('one'),
        start: { date: start },
        end: { date: end },
      }),
    });
    if (record.operation !== 'upsert') {
      throw new Error('Expected event');
    }
    expect(record.content?.body).toContain(`End (inclusive): ${inclusiveEnd} (all day)`);
    expect(record.data.end).toEqual({ date: end });
  },
);

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

test.each([
  { timestamp: '2026-10-01T00:30:00+05:30', display: '1 Oct 2026 at 00:30 (UTC+05:30)' },
  { timestamp: '2026-10-01T23:30:00-04:00', display: '1 Oct 2026 at 23:30 (UTC-04:00)' },
  { timestamp: '2026-10-01T09:00:00Z', display: '1 Oct 2026 at 09:00 (UTC)' },
])(
  'readable timestamps preserve the local date and offset of $timestamp',
  ({ timestamp, display }) => {
    const record = eventRecord({
      calendarId: 'a',
      timeZone: 'Europe/London',
      event: providerEventSchema.parse({
        ...event('one'),
        start: { dateTime: timestamp },
        end: { dateTime: timestamp },
        originalStartTime: { dateTime: timestamp },
      }),
    });
    if (record.operation !== 'upsert') {
      throw new Error('Expected event');
    }
    expect(record.content?.body).toContain(`Start: ${display}`);
    expect(record.content?.body).toContain(`End: ${display}`);
    expect(record.content?.body).toContain(`Original start: ${display}`);
    expect(record.data.sourceOccurredAt).toBe(timestamp);
    expect(record.data.start).toEqual({ dateTime: timestamp });
  },
);
