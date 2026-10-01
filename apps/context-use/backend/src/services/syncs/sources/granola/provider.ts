import type { SyncProvider } from '../../catalog.ts';
import { granolaMeetings } from './meetings/definition.ts';

export const granolaProvider = {
  id: 'granola',
  name: 'Granola',
  description: 'Bring your meeting notes into Context Use.',
  oauth: {
    createAppUrl: null,
  },
  syncs: [
    {
      name: 'Meetings',
      description: 'Notes from the last 30 days, saved as searchable records.',
      intervalMs: 900_000,
      registration: granolaMeetings,
    },
  ],
} satisfies SyncProvider;
