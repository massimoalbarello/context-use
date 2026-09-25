import { Elysia, StatusMap, t } from 'elysia';
import { ErrorResponseSchema } from '#backend/lib/errors.ts';
import { InvalidRecordAssetError } from '#backend/models/records/assets.ts';
import {
  RecordInputSchema,
  RecordPublicationConflictError,
  type RecordWriteResult,
} from '#backend/models/records/model.ts';
import { API_KEY_SECURITY_SCHEME } from '#backend/routes/api/api-keys/model.ts';
import { changeMessagePlugin } from '#backend/routes/api/change-message.ts';
import { withChangeMessage } from '#backend/routes/change-message.ts';
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
    .use(changeMessagePlugin)
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
        const { changeMessage, ...record } = body;
        let result: RecordWriteResult;
        try {
          result = await recordsService.upsert({
            ownerId: principal.ownerId,
            record,
            change: {
              clientName: principal.name,
              message: changeMessage,
            },
          });
        } catch (error) {
          if (error instanceof RecordPublicationConflictError) {
            return status(StatusMap.Conflict, { error: error.message });
          }
          if (error instanceof InvalidRecordAssetError) {
            return status(StatusMap['Bad Request'], { error: error.message });
          }
          throw error;
        }
        if (result.state === 'conflict') {
          return status(StatusMap.Conflict, {
            error:
              'Record has conflicting source data. Updates require comparable, newer sourceUpdatedAt timestamps.',
          });
        }
        return status(StatusMap.OK, { state: result.state, readableId: result.readableId });
      },
      {
        changeMessage: true,
        body: withChangeMessage(RecordInputSchema),
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
          [StatusMap['Bad Request']]: ErrorResponseSchema,
        },
        detail: {
          tags: ['Records'],
          summary: 'Create or update a native record',
          security: [{ [API_KEY_SECURITY_SCHEME]: [] }],
        },
      },
    );
}
