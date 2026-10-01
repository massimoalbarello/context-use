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
