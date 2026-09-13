import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { createAuthPlugin } from '#lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#lib/errors.ts';
import { RecordParamsSchema, RecordSchema, recordResponse } from '#routes/api/records/model.ts';
import type { RecordResourcesServiceContract } from '#services/records/service.ts';

export function createRecordReadableIdController({
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
      '/records/:recordReadableId',
      async ({ params, user, status }) => {
        const record = await recordsService.findResource({
          ownerId: user.id,
          readableId: params.recordReadableId,
        });
        return record
          ? status(StatusMap.OK, recordResponse(record))
          : status(StatusMap['Not Found'], { error: 'Record not found' });
      },
      {
        detail: { tags: ['Records'], summary: 'Read an externally synced record' },
        params: RecordParamsSchema,
        response: {
          [StatusMap.OK]: RecordSchema,
          [StatusMap['Not Found']]: ErrorResponseSchema,
        },
      },
    );
}
