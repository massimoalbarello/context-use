import type { OpenSyncOptions } from '@context-use/open-sync';

export function syncEventLogger(logger: {
  info: (message: string) => void;
  error: (message: string) => void;
}): NonNullable<OpenSyncOptions['onEvent']> {
  return (event) => {
    if (event.code === 'cancelled') {
      logger.info(JSON.stringify(event));
    } else {
      logger.error(JSON.stringify(event));
    }
  };
}
