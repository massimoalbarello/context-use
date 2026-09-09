import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { createAuthPlugin } from '#lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#lib/errors.ts';
import { DEFAULT_LIST_LIMIT } from '#routes/api/model.ts';
import {
  RecordListQuerySchema,
  RecordListSchema,
  recordSummaryResponse,
} from '#routes/api/records/model.ts';
import type { OpenConnectorRecordResourcesServiceContract } from '#services/open-connector/service.ts';

export function createRecordsController({
  auth,
  recordsService,
}: {
  auth: Auth;
  recordsService: OpenConnectorRecordResourcesServiceContract;
}) {
  return new Elysia()
    .use(createAuthPlugin({ auth }))
    .guard({ auth: true, response: { [StatusMap.Unauthorized]: ErrorResponseSchema } })
    .get(
      '/records',
      async ({ query, user, status }) => {
        const page = await recordsService.listResources({
          ownerId: user.id,
          limit: query.limit ?? DEFAULT_LIST_LIMIT,
          offset: query.offset ?? 0,
        });
        return status(StatusMap.OK, {
          ...page,
          items: page.items.map(recordSummaryResponse),
        });
      },
      {
        detail: { tags: ['Records'], summary: 'List active externally synced records' },
        query: RecordListQuerySchema,
        response: { [StatusMap.OK]: RecordListSchema },
      },
    );
}
