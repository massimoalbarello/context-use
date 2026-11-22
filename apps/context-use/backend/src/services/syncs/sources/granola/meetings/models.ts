import { z } from 'zod';
import { RecordInputSchema } from '#backend/models/records/model.ts';

export const meetingSchema = z.strictObject({
  title: z.string().nullable(),
  notes: z.string(),
  date: z.string().nullable(),
  sourceOccurredAt: RecordInputSchema.shape.sourceOccurredAt,
  attendees: z.string(),
});
// An existing MCP sync has an empty checkpoint and starts its API backfill at page one.
export const checkpointSchema = z.strictObject({ cursor: z.string().min(1).nullable().optional() });
export const noteIdSchema = z.string().regex(/^not_[a-zA-Z0-9]{14}$/);
export const responseSchema = z.object({
  notes: z.array(
    z.object({ id: noteIdSchema, deleted_at: z.iso.datetime({ offset: true }).nullable() }),
  ),
  hasMore: z.boolean(),
  cursor: z.string().min(1).nullable(),
});
// Require complete content so a partial response cannot erase a delivered summary.
export const noteSchema = z.object({
  id: noteIdSchema,
  web_url: z.url(),
  title: z.string().nullable(),
  summary_text: z.string(),
  summary_markdown: z.string().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
  deleted_at: z.iso.datetime({ offset: true }).nullable(),
  calendar_event: z
    .object({ scheduled_start_time: z.iso.datetime({ offset: true }).nullable() })
    .nullable(),
  attendees: z.array(z.object({ name: z.string().nullable(), email: z.string() })),
});
