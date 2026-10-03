import { runOpenSyncCron } from '@context-use/open-sync/cron';

if (await runOpenSyncCron()) {
  process.exit(0);
}

await import('./main.ts');
