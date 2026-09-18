import { Elysia, StatusMap, t } from 'elysia';
import { ErrorResponseSchema } from '#backend/lib/errors.ts';
import { RecordInputSchema } from '#backend/models/records/model.ts';
import { API_KEY_SECURITY_SCHEME } from '#backend/routes/api/api-keys/model.ts';
import type { ApiKeyAuthenticationContract } from '#backend/services/api-keys/service.ts';
import type { RecordsIngestionContract } from '#backend/services/records/service.ts';

export function createRecordWriteController({
  recordsService,
  apiKeysService,
}: {
  recordsService: Pick<RecordsIngestionContract, 'upsert'>;
  apiKeysService: ApiKeyAuthenticationContract;
}) {
  return new Elysia()
    .resolve(async ({ request, status }) => {
      const header = request.headers.get('authorization');
      const principal = header?.startsWith('Bearer ')
        ? await apiKeysService.authenticate({ apiKey: header.slice('Bearer '.length) })
        : null;
      if (!principal) {
        return status(StatusMap.Unauthorized, { error: 'Unauthorized' });
      }
      return { principal };
    })
    .post(
      '/records',
      async ({ body, principal, status }) => {
        const result = await recordsService.upsert({ ownerId: principal.ownerId, record: body });
        if (result.state === 'conflict') {
          return status(StatusMap.Conflict, {
            error:
              'Record has conflicting source data. Updates require comparable, newer sourceUpdatedAt timestamps.',
          });
        }
        return status(StatusMap.OK, { state: result.state, readableId: result.readableId });
      },
      {
        body: RecordInputSchema,
        response: {
          [StatusMap.OK]: t.Object({
            state: t.Union([
              t.Literal('created'),
              t.Literal('updated'),
              t.Literal('unchanged'),
              t.Literal('stale'),
            ]),
            readableId: t.String(),
          }),
          [StatusMap.Unauthorized]: ErrorResponseSchema,
          [StatusMap.Conflict]: ErrorResponseSchema,
        },
        detail: {
          tags: ['Records'],
          summary: 'Create or update a native record',
          security: [{ [API_KEY_SECURITY_SCHEME]: [] }],
        },
      },
    );
}
