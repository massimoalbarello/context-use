import type { SyncRecord } from '@context-use/open-sync/record';
import type { z } from 'zod';
import { RecordInputSchema } from '#backend/models/records/model.ts';
import { meetingIdFromUrl } from './identity.ts';
import type { noteSchema } from './models.ts';

export function granolaRecord(meeting: z.infer<typeof noteSchema>) {
  const date = meeting.calendar_event?.scheduled_start_time ?? null;
  const data = {
    title: meeting.title,
    notes: meeting.summary_markdown ?? meeting.summary_text,
    date,
    sourceOccurredAt: RecordInputSchema.shape.sourceOccurredAt.parse(date),
    attendees: meeting.attendees
      .map(({ name, email }) => (name?.trim() ? `${name} <${email}>` : email))
      .join(', '),
  };
  return {
    operation: 'upsert',
    kind: 'meeting',
    id: meetingIdFromUrl(meeting.web_url),
    preview: meeting.title?.trim() || 'Untitled Granola meeting',
    content: {
      format: 'markdown',
      body: [
        ...(data.date ? [`Date: ${data.date}`] : []),
        ...(data.attendees ? [`Attendees: ${data.attendees}`] : []),
        data.notes,
      ].join('\n\n'),
    },
    data,
    createdAt: meeting.created_at,
    updatedAt: meeting.updated_at,
  } satisfies SyncRecord;
}
