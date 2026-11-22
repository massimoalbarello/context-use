import type { SyncProvider } from '../../catalog.ts';
import { googleCalendarEvents } from './definition.ts';
import { INVALID_CHECKPOINT_CODE } from './request.ts';

export const googleCalendarProvider = {
  id: 'googlecalendar',
  name: 'Google Calendar',
  description: 'Bring calendar events into Context Use.',
  oauth: { createAppUrl: 'https://console.cloud.google.com/auth/clients' },
  syncs: [
    {
      name: 'Calendar events',
      description: 'Events from your calendars.',
      invalidCheckpointCode: INVALID_CHECKPOINT_CODE,
      registration: googleCalendarEvents,
    },
  ],
} satisfies SyncProvider;
