import { Elysia, StatusMap, t } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { createAuthPlugin } from '#backend/lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#backend/lib/errors.ts';
import {
  ApiKeyListSchema,
  ApiKeyParamsSchema,
  apiKeyResponse,
  CreateApiKeyBodySchema,
  CreateApiKeyResponseSchema,
} from '#backend/routes/api/api-keys/model.ts';
import { changeMessagePlugin } from '#backend/routes/api/change-message.ts';
import type { ApiKeysServiceContract } from '#backend/services/api-keys/service.ts';

const errorResponses = {
  [StatusMap['Bad Request']]: ErrorResponseSchema,
  [StatusMap.Unauthorized]: ErrorResponseSchema,
  [StatusMap.Forbidden]: ErrorResponseSchema,
  [StatusMap['Not Found']]: ErrorResponseSchema,
};

export function createApiKeysController({
  auth,
  apiKeysService,
}: {
  auth: Auth;
  apiKeysService: ApiKeysServiceContract;
}) {
  return new Elysia()
    .use(changeMessagePlugin)
    .use(createAuthPlugin({ auth }))
    .guard({ auth: true, response: errorResponses })
    .get(
      '/api-keys',
      async ({ user, status }) => {
        const result = await apiKeysService.list({ actorId: user.id });
        if (result.state === 'forbidden') {
          return status(StatusMap.Forbidden, { error: 'Forbidden' });
        }
        return status(StatusMap.OK, { items: result.keys.map(apiKeyResponse) });
      },
      {
        detail: { tags: ['API keys'], summary: 'List API keys' },
        response: { [StatusMap.OK]: ApiKeyListSchema },
      },
    )
    .post(
      '/api-keys',
      async ({ body, user, status }) => {
        const result = await apiKeysService.create({ actorId: user.id, name: body.name });
        if (result.state === 'forbidden') {
          return status(StatusMap.Forbidden, { error: 'Forbidden' });
        }
        if (result.state === 'invalid') {
          return status(StatusMap['Bad Request'], { error: 'Invalid key name' });
        }
        if (result.state === 'name_conflict') {
          return status(StatusMap.Conflict, { error: 'An active key already uses this name' });
        }
        return status(StatusMap.Created, {
          key: apiKeyResponse(result.key),
          apiKey: result.apiKey,
        });
      },
      {
        changeMessage: true,
        detail: { tags: ['API keys'], summary: 'Create an API key' },
        body: CreateApiKeyBodySchema,
        response: {
          [StatusMap.Created]: CreateApiKeyResponseSchema,
          [StatusMap.Conflict]: ErrorResponseSchema,
        },
      },
    )
    .put(
      '/api-keys/:keyReadableId/revoke',
      async ({ params, user, status }) => {
        const result = await apiKeysService.revoke({
          actorId: user.id,
          readableId: params.keyReadableId,
        });
        if (result.state === 'forbidden') {
          return status(StatusMap.Forbidden, { error: 'Forbidden' });
        }
        if (result.state === 'not_found') {
          return status(StatusMap['Not Found'], { error: 'API key not found' });
        }
        return status(StatusMap['No Content'], undefined);
      },
      {
        changeMessage: true,
        detail: { tags: ['API keys'], summary: 'Revoke an API key' },
        params: ApiKeyParamsSchema,
        response: { [StatusMap['No Content']]: t.Void() },
      },
    );
}
