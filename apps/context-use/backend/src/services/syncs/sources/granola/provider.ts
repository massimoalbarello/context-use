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
      description:
        'Notes from the last 30 days, saved as searchable records. New meetings and edits are checked automatically; saved records are kept after they leave this window.',
      intervalMs: 900_000,
      registration: granolaMeetings,
    },
  ],
} satisfies SyncProvider;
