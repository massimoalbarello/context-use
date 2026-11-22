import { z } from 'zod';
import type { LocalSyncRegistration } from '../../catalog.ts';
import { checkpointSchema, initialCheckpoint, recordSchema } from './models.ts';
import { step } from './threads.ts';

export const gmailThreads = {
  recordIdentity: 'source',
  definition: {
    id: 'gmail.threads',
    name: 'Gmail conversations',
    configSchema: { type: 'object', additionalProperties: false },
    checkpointSchema: JSON.parse(JSON.stringify(z.toJSONSchema(checkpointSchema))),
    initialCheckpoint,
    kinds: { thread: JSON.parse(JSON.stringify(z.toJSONSchema(recordSchema))) },
    provider: {
      service: 'gmail',
      actions: ['gmail.download_attachment'],
      proxyPaths: [
        '/users/me/profile',
        '/users/me/labels',
        '/users/me/threads',
        '/users/me/threads/:id',
        '/users/me/history',
      ],
    },
  },
  load: () => ({ step }),
} satisfies LocalSyncRegistration;
