import type { SyncRecord } from '@context-use/open-sync/record';
import type { z } from 'zod';
import type { detailResponseSchema } from './models.ts';

export function granolaRecord(meeting: z.infer<typeof detailResponseSchema>['meetings'][number]) {
  const data = {
    title: meeting.title,
    notes: meeting.summary,
    date: meeting.date ?? null,
    attendees: meeting.attendees ?? '',
  };
  return {
    operation: 'upsert',
    kind: 'meeting',
    id: meeting.id,
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
    // MCP meeting dates are not note creation/update timestamps.
  } satisfies SyncRecord;
}
