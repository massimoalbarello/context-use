import type { SyncRegistration } from '@context-use/open-sync/definition';
import { z } from 'zod';
import { checkpointSchema, meetingSchema } from './models.ts';
import { stepGranolaMeetings } from './step.ts';

export const granolaMeetings = {
  definition: {
    id: 'granola.meetings',
    name: 'Granola meetings',
    provider: { service: 'granola', actions: [], proxyPaths: ['/v1/notes', '/v1/notes/:id'] },
    configSchema: { type: 'object', additionalProperties: false },
    checkpointSchema: JSON.parse(JSON.stringify(z.toJSONSchema(checkpointSchema))),
    initialCheckpoint: {},
    kinds: { meeting: JSON.parse(JSON.stringify(z.toJSONSchema(meetingSchema))) },
  },
  load: () => ({ step: stepGranolaMeetings }),
} satisfies SyncRegistration;
