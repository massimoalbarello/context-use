import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { createAuthPlugin } from '#lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#lib/errors.ts';
import { DEFAULT_LIST_LIMIT } from '#routes/api/model.ts';
import {
  invalidRecordDateRange,
  RecordFilterOptionsSchema,
  RecordListQuerySchema,
  RecordListSchema,
  recordSummaryResponse,
} from '#routes/api/records/model.ts';
import type { RecordResourcesServiceContract } from '#services/records/service.ts';

export function createRecordsController({
  auth,
  recordsService,
}: {
  auth: Auth;
  recordsService: RecordResourcesServiceContract;
}) {
  return new Elysia()
    .use(createAuthPlugin({ auth }))
    .guard({ auth: true, response: { [StatusMap.Unauthorized]: ErrorResponseSchema } })
    .get(
      '/records/filter-options',
      ({ user }) => recordsService.filterOptions({ ownerId: user.id }),
      {
        detail: { tags: ['Records'], summary: 'List available record filters' },
        response: { [StatusMap.OK]: RecordFilterOptionsSchema },
      },
    )
    .get(
      '/records',
      async ({ query, user, status }) => {
        if (
          invalidRecordDateRange({ from: query.createdFrom, to: query.createdTo }) ||
          invalidRecordDateRange({ from: query.updatedFrom, to: query.updatedTo })
        ) {
          return status(StatusMap['Bad Request'], {
            error: 'The end of a source date range must be after its start.',
          });
        }
        const page = await recordsService.listResources({
          ownerId: user.id,
          limit: query.limit ?? DEFAULT_LIST_LIMIT,
          offset: query.offset ?? 0,
          provider: query.provider,
          kind: query.kind,
          createdFrom: query.createdFrom?.toISOString(),
          createdTo: query.createdTo?.toISOString(),
          updatedFrom: query.updatedFrom?.toISOString(),
          updatedTo: query.updatedTo?.toISOString(),
          sortBy: query.sortBy,
          sortDirection: query.sortDirection,
        });
        return status(StatusMap.OK, {
          ...page,
          items: page.items.map(recordSummaryResponse),
        });
      },
      {
        detail: { tags: ['Records'], summary: 'List active externally synced records' },
        query: RecordListQuerySchema,
        response: {
          [StatusMap.OK]: RecordListSchema,
          [StatusMap['Bad Request']]: ErrorResponseSchema,
        },
      },
    );
}
