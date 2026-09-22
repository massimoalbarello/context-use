import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { createAuthPlugin } from '#backend/lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#backend/lib/errors.ts';
import { DEFAULT_LIST_LIMIT } from '#backend/routes/api/model.ts';
import type { HistoryServiceContract } from '#backend/services/history/service.ts';
import { HistoryPageSchema, HistoryQuerySchema } from './model.ts';

function decodeCursor(cursor: string | undefined) {
  if (cursor === undefined) {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      Number.isFinite(Date.parse(value[0])) &&
      new Date(value[0]).toISOString() === value[0] &&
      Number.isSafeInteger(value[1]) &&
      value[1] > 0
    ) {
      return { createdAt: value[0], sequence: value[1] as number };
    }
  } catch {
    /* Invalid cursors are rejected at the transport boundary. */
  }
  return null;
}

export function createHistoryController({
  auth,
  historyService,
}: {
  auth: Auth;
  historyService: HistoryServiceContract;
}) {
  return new Elysia()
    .use(createAuthPlugin({ auth }))
    .guard({ auth: true, response: { [StatusMap.Unauthorized]: ErrorResponseSchema } })
    .get(
      '/history',
      async ({ user, query, status }) => {
        const before = decodeCursor(query.cursor);
        if (before === null) {
          return status(StatusMap['Bad Request'], {
            error: 'Invalid history cursor. Restart the history list.',
          });
        }
        const page = await historyService.list({
          ownerId: user.id,
          resourceType: query.resourceType,
          limit: query.limit ?? DEFAULT_LIST_LIMIT,
          before,
        });
        return {
          items: page.items.map((item) => ({ ...item, createdAt: new Date(item.createdAt) })),
          nextCursor: page.next
            ? Buffer.from(JSON.stringify([page.next.createdAt, page.next.sequence])).toString(
                'base64url',
              )
            : null,
        };
      },
      {
        query: HistoryQuerySchema,
        response: {
          [StatusMap.OK]: HistoryPageSchema,
          [StatusMap['Bad Request']]: ErrorResponseSchema,
        },
        detail: { tags: ['History'], summary: 'List resource changes, newest first' },
      },
    );
}
