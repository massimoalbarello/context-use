import type { Logger } from '#backend/lib/logger.ts';

export type RequestLogger = (request: Request) => Logger;

export function createRequestLogger(logger: Logger): RequestLogger {
  const loggers = new WeakMap<Request, Logger>();
  return (request) => {
    let requestLogger = loggers.get(request);
    if (!requestLogger) {
      requestLogger = logger.child({
        requestId: Bun.randomUUIDv7(),
        method: request.method,
        path: new URL(request.url).pathname,
      });
      loggers.set(request, requestLogger);
    }
    return requestLogger;
  };
}
