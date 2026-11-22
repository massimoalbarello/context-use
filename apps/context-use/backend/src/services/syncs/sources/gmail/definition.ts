import type { SyncRegistration } from '@context-use/open-sync/definition';
import { z } from 'zod';
import { checkpointSchema, initialCheckpoint, recordSchema } from './models.ts';
import { step } from './threads.ts';

export const gmailThreads = {
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
} satisfies SyncRegistration;
