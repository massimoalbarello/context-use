import { Elysia, StatusMap, t } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { createAuthPlugin } from '#backend/lib/auth/plugin.ts';
import { ErrorResponseSchema, ForbiddenError } from '#backend/lib/errors.ts';
import { changeMessagePlugin } from '#backend/routes/api/change-message.ts';
import type { ManagedSyncsServiceContract } from '#backend/services/syncs/managed.ts';
import {
  ActionBodySchema,
  ManagedSyncListSchema,
  OAuthAppBodySchema,
  ProviderParamsSchema,
} from './model.ts';

export function createManagedSyncsController(input: {
  auth: Auth;
  syncs: ManagedSyncsServiceContract;
}) {
  return new Elysia({ prefix: '/syncs/managed' })
    .use(changeMessagePlugin)
    .use(createAuthPlugin({ auth: input.auth }))
    .guard({
      auth: true,
      response: {
        [StatusMap.Unauthorized]: ErrorResponseSchema,
        [StatusMap.Forbidden]: ErrorResponseSchema,
        [StatusMap['Bad Request']]: ErrorResponseSchema,
        [StatusMap['Not Found']]: ErrorResponseSchema,
      },
    })
    .onBeforeHandle(({ request }) => {
      if (
        request.method !== 'GET' &&
        !input.auth.passkeyOrigins.includes(request.headers.get('origin') ?? '')
      ) {
        throw new ForbiddenError();
      }
    })
    .get(
      '/',
      async ({ user, status }) =>
        status(StatusMap.OK, await input.syncs.list({ actorId: user.id })),
      {
        response: { [StatusMap.OK]: ManagedSyncListSchema },
        detail: { tags: ['Syncs'], summary: 'List locally managed syncs' },
      },
    )
    .post(
      '/providers/:providerId/app',
      async ({ user, body, params }) => {
        await input.syncs.configureApp({
          actorId: user.id,
          providerId: params.providerId,
          clientId: body.clientId,
          clientSecret: body.clientSecret,
        });
        return null;
      },
      {
        changeMessage: true,
        params: ProviderParamsSchema,
        body: OAuthAppBodySchema,
        response: { [StatusMap.OK]: t.Null() },
        detail: { tags: ['Syncs'], summary: 'Save provider OAuth app credentials' },
      },
    )
    .post(
      '/providers/:providerId/connect',
      ({ user, params }) =>
        input.syncs.connect({ actorId: user.id, providerId: params.providerId }),
      {
        changeMessage: true,
        params: ProviderParamsSchema,
        response: { [StatusMap.OK]: t.Object({ authorizationUrl: t.Nullable(t.String()) }) },
        detail: { tags: ['Syncs'], summary: 'Connect an account and start its syncs' },
      },
    )
    .post(
      '/:key',
      async ({ user, body, params }) => {
        await input.syncs.update({ actorId: user.id, key: params.key, action: body.action });
        return null;
      },
      {
        changeMessage: true,
        params: t.Object({ key: t.String({ maxLength: 128 }) }),
        body: ActionBodySchema,
        response: { [StatusMap.OK]: t.Null() },
        detail: { tags: ['Syncs'], summary: 'Pause, resume, or run a sync' },
      },
    );
}
