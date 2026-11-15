import { Elysia, StatusMap } from 'elysia';
import { createLogger } from '#backend/lib/logger.ts';
import { createRequestLogger, type RequestLogger } from '#backend/lib/request-logger.ts';

function resolveStatus(status: number | keyof StatusMap | undefined): number {
  return typeof status === 'string' ? StatusMap[status] : (status ?? StatusMap.OK);
}

export function createRequestResponsePlugin({
  requestLogger = createRequestLogger(createLogger({ scope: 'http' })),
}: {
  requestLogger?: RequestLogger;
} = {}) {
  const startedAt = new WeakMap<Request, number>();
  return new Elysia({ name: 'request-response' })
    .onRequest(({ request, set }) => {
      startedAt.set(request, performance.now());
      set.headers['x-request-id'] = requestLogger(request).bindings().requestId;
    })
    .onAfterResponse(({ request, set, responseValue }) => {
      const started = startedAt.get(request);
      // Elysia also runs response hooks when registering static responses at startup.
      if (started === undefined) {
        return;
      }
      const status =
        responseValue instanceof Response ? responseValue.status : resolveStatus(set.status);
      const logger = requestLogger(request);
      const level =
        status >= StatusMap['Internal Server Error']
          ? 'error'
          : status >= StatusMap['Bad Request']
            ? 'warn'
            : 'info';
      logger[level](
        {
          event: 'http.request.completed',
          status,
          durationMs: Math.round(performance.now() - started),
        },
        'HTTP request completed',
      );
    })
    .as('global');
}
