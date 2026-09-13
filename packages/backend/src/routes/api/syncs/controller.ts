import { Elysia, StatusMap, t } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { createAuthPlugin } from '#lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#lib/errors.ts';
import {
  CreateRecordSyncBodySchema,
  CreateRecordSyncResponseSchema,
  RecordSyncListSchema,
  RecordSyncParamsSchema,
  recordSyncResponse,
} from '#routes/api/syncs/model.ts';
import type { RecordSyncsServiceContract } from '#services/syncs/service.ts';

const errorResponses = {
  [StatusMap['Bad Request']]: ErrorResponseSchema,
  [StatusMap.Unauthorized]: ErrorResponseSchema,
  [StatusMap.Forbidden]: ErrorResponseSchema,
  [StatusMap['Not Found']]: ErrorResponseSchema,
};

export function createRecordSyncsController({
  auth,
  syncsService,
}: {
  auth: Auth;
  syncsService: RecordSyncsServiceContract;
}) {
  return new Elysia()
    .use(createAuthPlugin({ auth }))
    .guard({ auth: true, response: errorResponses })
    .get(
      '/syncs',
      async ({ user, status }) => {
        const result = await syncsService.list({ actorId: user.id });
        if (result.state === 'forbidden') {
          return status(StatusMap.Forbidden, { error: 'Forbidden' });
        }
        return status(StatusMap.OK, { items: result.syncs.map(recordSyncResponse) });
      },
      {
        detail: { tags: ['Syncs'], summary: 'List record syncs' },
        response: { [StatusMap.OK]: RecordSyncListSchema },
      },
    )
    .post(
      '/syncs',
      async ({ body, user, status }) => {
        const result = await syncsService.create({ actorId: user.id, name: body.name });
        if (result.state === 'forbidden') {
          return status(StatusMap.Forbidden, { error: 'Forbidden' });
        }
        if (result.state === 'invalid') {
          return status(StatusMap['Bad Request'], { error: 'Invalid sync name' });
        }
        if (result.state === 'name_conflict') {
          return status(StatusMap.Conflict, { error: 'An active sync already uses this name' });
        }
        return status(StatusMap.Created, {
          sync: recordSyncResponse(result.sync),
          apiKey: result.apiKey,
        });
      },
      {
        detail: { tags: ['Syncs'], summary: 'Create a record sync and issue its API key' },
        body: CreateRecordSyncBodySchema,
        response: {
          [StatusMap.Created]: CreateRecordSyncResponseSchema,
          [StatusMap.Conflict]: ErrorResponseSchema,
        },
      },
    )
    .put(
      '/syncs/:syncReadableId/revoke',
      async ({ params, user, status }) => {
        const result = await syncsService.revoke({
          actorId: user.id,
          readableId: params.syncReadableId,
        });
        if (result.state === 'forbidden') {
          return status(StatusMap.Forbidden, { error: 'Forbidden' });
        }
        if (result.state === 'not_found') {
          return status(StatusMap['Not Found'], { error: 'Sync not found' });
        }
        return status(StatusMap['No Content'], undefined);
      },
      {
        detail: { tags: ['Syncs'], summary: 'Revoke a record sync API key' },
        params: RecordSyncParamsSchema,
        response: { [StatusMap['No Content']]: t.Void() },
      },
    );
}
