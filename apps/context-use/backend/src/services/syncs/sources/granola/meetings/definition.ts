import type { SyncRegistration } from '@context-use/open-sync/definition';
import { z } from 'zod';
import { checkpointSchema, meetingSchema } from './models.ts';
import { stepGranolaMeetings } from './step.ts';

export const granolaMeetings = {
  definition: {
    id: 'granola.meetings',
    name: 'Granola meetings',
    provider: { service: 'granola', actions: ['granola.list_meetings', 'granola.get_meetings'] },
    configSchema: { type: 'object', additionalProperties: false },
    checkpointSchema: JSON.parse(JSON.stringify(z.toJSONSchema(checkpointSchema))),
    initialCheckpoint: {},
    kinds: { meeting: JSON.parse(JSON.stringify(z.toJSONSchema(meetingSchema))) },
  },
  load: () => ({ step: stepGranolaMeetings }),
} satisfies SyncRegistration;
