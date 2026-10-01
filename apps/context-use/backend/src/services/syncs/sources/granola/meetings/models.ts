import { z } from 'zod';

export const meetingSchema = z.strictObject({
  title: z.string().nullable(),
  notes: z.string(),
  date: z.string().nullable(),
  attendees: z.string(),
});
// Empty by design: the OAuth action exposes one unpaginated last-30-days listing,
// with no update token. Every detail batch finishes in this step, so there is no
// position, pending ID list, or timestamp to resume. The next poll rechecks the listing.
export const checkpointSchema = z.strictObject({});
export const responseSchema = z.object({
  meetings: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().nullable(),
      summary: z.string().optional(),
      date: z.string().optional(),
      attendees: z.string().optional(),
    }),
  ),
});
// Listing previews may omit summaries; complete details must distinguish empty notes
// from missing notes so a partial response cannot erase an earlier delivered summary.
export const detailResponseSchema = responseSchema.extend({
  meetings: z.array(responseSchema.shape.meetings.element.extend({ summary: z.string() })),
});
