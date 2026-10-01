import { githubProvider } from './github/provider.ts';
import { granolaProvider } from './granola/provider.ts';
import { youtubeProvider } from './youtube/provider.ts';

export const syncProviders = [githubProvider, granolaProvider, youtubeProvider];
