import { githubProvider } from './github/provider.ts';
import { gmailProvider } from './gmail/provider.ts';
import { googleCalendarProvider } from './googlecalendar/provider.ts';
import { granolaProvider } from './granola/provider.ts';
import { youtubeProvider } from './youtube/provider.ts';

export const syncProviders = [
  githubProvider,
  gmailProvider,
  granolaProvider,
  youtubeProvider,
  googleCalendarProvider,
];
