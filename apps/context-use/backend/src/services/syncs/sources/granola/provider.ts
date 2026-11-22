import type { SyncProvider } from '../../catalog.ts';
import { granolaMeetings } from './meetings/definition.ts';

export const granolaProvider = {
  id: 'granola',
  name: 'Granola',
  description: 'Bring your meeting notes into Context Use.',
  oauth: null,
  apiKeySetupUrl: 'https://docs.granola.ai/help-center/sharing/integrations/granola-api',
  syncs: [
    {
      name: 'Meetings',
      description: 'All meeting notes accessible to your API key.',
      registration: granolaMeetings,
    },
  ],
} satisfies SyncProvider;
