import type { SyncRecord } from '@context-use/open-sync/record';
import TurndownService from 'turndown';
import { z } from 'zod';
import { RecordInputSchema } from '#backend/models/records/model.ts';

const id = z.string().min(1);
const timestamp = z.iso.datetime({ offset: true });
const timeSchema = z.union([
  z.object({ date: z.iso.date(), timeZone: z.string().optional() }),
  z.object({ dateTime: timestamp, timeZone: z.string().optional() }),
]);
const personSchema = z.object({
  id: z.string().optional(),
  email: z.string().optional(),
  displayName: z.string().optional(),
  self: z.boolean().optional(),
});
const attendeeSchema = personSchema.extend({
  organizer: z.boolean().optional(),
  optional: z.boolean().optional(),
  resource: z.boolean().optional(),
  responseStatus: z.string().optional(),
  comment: z.string().optional(),
  additionalGuests: z.number().int().nonnegative().optional(),
});
export const providerEventSchema = z.object({
  id,
  status: z.enum(['confirmed', 'tentative', 'cancelled']),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  htmlLink: z.url().optional(),
  start: timeSchema.optional(),
  end: timeSchema.optional(),
  endTimeUnspecified: z.boolean().optional(),
  attendees: z.array(attendeeSchema).optional(),
  attendeesOmitted: z.boolean().optional(),
  organizer: personSchema.optional(),
  creator: personSchema.optional(),
  recurrence: z.array(z.string()).optional(),
  recurringEventId: id.optional(),
  originalStartTime: timeSchema.optional(),
  iCalUID: z.string().optional(),
  hangoutLink: z.url().optional(),
  eventType: z.string().optional(),
  created: timestamp.optional(),
  updated: timestamp.optional(),
});
export const eventPageSchema = z.object({
  items: z.array(providerEventSchema).default([]),
  nextPageToken: id.optional(),
  nextSyncToken: id.optional(),
  timeZone: z.string().optional(),
});
export const eventSchema = z.strictObject({
  calendarId: id,
  eventId: id,
  title: z.string(),
  status: providerEventSchema.shape.status,
  sourceOccurredAt: RecordInputSchema.shape.sourceOccurredAt,
  start: timeSchema.nullable(),
  end: timeSchema.nullable(),
  timeZone: z.string().nullable(),
  endTimeUnspecified: z.boolean(),
  participants: z.array(attendeeSchema),
  participantsOmitted: z.boolean(),
  organizer: personSchema.nullable(),
  creator: personSchema.nullable(),
  location: z.string().nullable(),
  description: z.string().nullable(),
  url: z.url().nullable(),
  meetingUrl: z.url().nullable(),
  recurrence: z.array(z.string()),
  recurringEventId: id.nullable(),
  originalStartTime: timeSchema.nullable(),
  iCalUID: z.string().nullable(),
  eventType: z.string().nullable(),
});
function time(value: z.infer<typeof timeSchema> | null) {
  if (!value) {
    return 'Unavailable';
  }
  if ('date' in value) {
    const date = new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(new Date(`${value.date}T00:00:00Z`));
    return `${date} (all day)`;
  }
  const offset = value.dateTime.match(/[+-]\d{2}:\d{2}$/)?.[0] ?? null;
  const instant = new Date(value.dateTime);
  const date = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeZone: offset ?? 'UTC',
  }).format(instant);
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeStyle: 'short',
    timeZone: offset ?? 'UTC',
  }).format(instant);
  return `${date} at ${clock} (${offset ? `UTC${offset}` : 'UTC'})`;
}
function occurrenceTime(value: z.infer<typeof timeSchema> | undefined) {
  if (!value) {
    return null;
  }
  return 'date' in value ? value.date : value.dateTime;
}
function readableEnd(value: z.infer<typeof timeSchema> | null) {
  if (value && 'date' in value) {
    const end = new Date(`${value.date}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() - 1);
    return `End (inclusive): ${time({ ...value, date: end.toISOString().slice(0, 10) })}`;
  }
  return `End: ${time(value)}`;
}
function person(value: z.infer<typeof personSchema>) {
  return [value.displayName, value.email].filter(Boolean).join(' — ') || value.id || 'Unavailable';
}
export function eventRecord(input: {
  event: z.infer<typeof providerEventSchema>;
  calendarId: string;
  timeZone?: string;
}): SyncRecord {
  const { event } = input;
  if (event.status !== 'cancelled' && (!event.start || !event.end)) {
    throw new Error('Google Calendar returned an event without its time range.');
  }
  const data = eventData(input);
  return {
    operation: 'upsert',
    kind: 'event',
    id: JSON.stringify([input.calendarId, event.id]),
    data,
    preview: data.title,
    ...(event.created ? { createdAt: event.created } : {}),
    ...(event.updated ? { updatedAt: event.updated } : {}),
    content: {
      format: 'markdown',
      body: readableEvent(data),
    },
  };
}

function readableEvent(data: z.infer<typeof eventSchema>) {
  return [
    `# ${data.title}`,
    `Status: ${data.status}`,
    `Start: ${time(data.start)}`,
    readableEnd(data.end),
    data.timeZone ? `Calendar time zone: ${data.timeZone}` : '',
    `Calendar: ${data.calendarId}`,
    data.organizer ? `Organizer: ${person(data.organizer)}` : '',
    data.creator ? `Creator: ${person(data.creator)}` : '',
    readableParticipants(data),
    data.location ? `Location: ${data.location}` : '',
    data.description
      ? `Description:\n\n${new TurndownService({ headingStyle: 'atx' }).turndown(data.description)}`
      : '',
    data.url ? `Event URL: ${data.url}` : '',
    data.meetingUrl ? `Meeting URL: ${data.meetingUrl}` : '',
    data.recurrence.length ? `Recurrence:\n${data.recurrence.join('\n')}` : '',
    data.recurringEventId ? `Recurring event: ${data.recurringEventId}` : '',
    data.originalStartTime ? `Original start: ${time(data.originalStartTime)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function readableParticipants(data: z.infer<typeof eventSchema>) {
  return [
    data.participants.length
      ? `Participants:\n${data.participants
          .map(
            (entry) =>
              `- ${person(entry)}${entry.responseStatus ? ` (${entry.responseStatus})` : ''}${entry.optional ? ' — optional' : ''}${entry.resource ? ' — resource' : ''}${entry.comment ? ` — ${entry.comment}` : ''}`,
          )
          .join('\n')}`
      : '',
    data.participantsOmitted ? 'Some participant details were omitted by Google.' : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function recurringDetails(event: z.infer<typeof providerEventSchema>) {
  return {
    recurrence: event.recurrence ?? [],
    recurringEventId: event.recurringEventId ?? null,
    originalStartTime: event.originalStartTime ?? null,
    iCalUID: event.iCalUID ?? null,
    eventType: event.eventType ?? null,
  };
}

function eventData(input: {
  event: z.infer<typeof providerEventSchema>;
  calendarId: string;
  timeZone?: string;
}): z.infer<typeof eventSchema> {
  const { event } = input;
  return {
    calendarId: input.calendarId,
    eventId: event.id,
    title:
      event.summary ||
      (event.status === 'cancelled' ? 'Cancelled calendar event' : 'Untitled calendar event'),
    status: event.status,
    sourceOccurredAt: occurrenceTime(event.start),
    start: event.start ?? null,
    end: event.end ?? null,
    timeZone: input.timeZone ?? null,
    endTimeUnspecified: event.endTimeUnspecified ?? false,
    participants: event.attendees ?? [],
    participantsOmitted: event.attendeesOmitted ?? false,
    organizer: event.organizer ?? null,
    creator: event.creator ?? null,
    location: event.location ?? null,
    description: event.description ?? null,
    url: event.htmlLink ?? null,
    meetingUrl: event.hangoutLink ?? null,
    ...recurringDetails(event),
  };
}
