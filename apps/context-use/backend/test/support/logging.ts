import { createLogger } from '#backend/lib/logger.ts';

export function captureLogs() {
  const lines: string[] = [];
  const logger = createLogger({
    scope: 'test',
    destination: {
      write: (line) => {
        lines.push(line);
      },
    },
  });
  return {
    logger,
    lines,
    records: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
