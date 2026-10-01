import type { SyncProvider } from '../../catalog.ts';
import { granolaMcpMeetings } from './meetings/definition.ts';

export const granolaMcpProvider = {
  id: 'granola-mcp',
  service: 'granola',
  name: 'Granola MCP',
  description: 'Bring your meeting notes into Context Use.',
  oauth: {
    createAppUrl: null,
  },
  syncs: [
    {
      name: 'Meetings',
      description: 'Notes from the last 30 days.',
      intervalMs: 900_000,
      registration: granolaMcpMeetings,
    },
  ],
} satisfies SyncProvider;
