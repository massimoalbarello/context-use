import type { SyncRegistration } from '@context-use/open-sync/definition';
import { z } from 'zod';

import { step } from './events.ts';
import { checkpointSchema, initialCheckpoint } from './models.ts';
import { eventSchema } from './records.ts';

const jsonSchema = (schema: z.ZodType) => JSON.parse(JSON.stringify(z.toJSONSchema(schema)));

export const googleCalendarEvents = {
  definition: {
    id: 'googlecalendar.events',
    name: 'Google Calendar events',
    description:
      'Events from calendars with readable event access, including hidden calendars. Backfills once, then uses per-calendar change tokens for additions, edits, and cancellations. Recurring series and exceptions are preserved without expanding instances. Cancelled events remain marked records; calendar removal does not delete records. Expired cursors require explicit resync; history missing after expiry cannot be reconciled automatically.',
    provider: {
      service: 'googlecalendar',
      actions: [],
      proxyPaths: ['/calendars/primary', '/users/me/calendarList', '/calendars/:id/events'],
    },
    configSchema: { type: 'object', additionalProperties: false },
    checkpointSchema: jsonSchema(checkpointSchema),
    initialCheckpoint,
    kinds: { event: jsonSchema(eventSchema) },
  },
  load: () => ({ step }),
} satisfies SyncRegistration;
