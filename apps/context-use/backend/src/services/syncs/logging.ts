import type { OpenSyncOptions } from '@context-use/open-sync';
import type { createLogger } from '#backend/lib/logger.ts';

export function syncEventLogger(
  logger: Pick<ReturnType<typeof createLogger>, 'info' | 'error'>,
): NonNullable<OpenSyncOptions['onEvent']> {
  return (event) => {
    const outcome = event.fields?.outcome;
    const informational =
      event.code === 'cancelled' ||
      (event.code === 'definition_log' &&
        (outcome === undefined || outcome === 'success' || outcome === 'cancelled'));
    const write = informational ? logger.info : logger.error;
    write(JSON.stringify(event));
  };
}
