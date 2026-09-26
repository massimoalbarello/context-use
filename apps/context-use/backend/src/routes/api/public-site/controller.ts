import { Elysia, StatusMap, t } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { createAuthPlugin } from '#backend/lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#backend/lib/errors.ts';
import type { PublicSiteServiceContract } from '#backend/services/public-site/service.ts';
import { PublicSiteSettingsSchema, SetHomepageBodySchema } from './model.ts';

export function createPublicSiteController({
  auth,
  publicSiteService,
}: {
  auth: Auth;
  publicSiteService: PublicSiteServiceContract;
}) {
  return new Elysia({ prefix: '/public-site' })
    .use(createAuthPlugin({ auth }))
    .guard({ auth: true, response: { [StatusMap.Unauthorized]: ErrorResponseSchema } })
    .get('/', ({ user }) => publicSiteService.settings({ ownerId: user.id }), {
      response: { [StatusMap.OK]: PublicSiteSettingsSchema },
      detail: { tags: ['Public site'], summary: 'Read the public homepage selection' },
    })
    .put(
      '/homepage',
      async ({ user, body, status }) => {
        const saved = await publicSiteService.setHomepage({ ownerId: user.id, ...body });
        return saved
          ? { saved: true as const }
          : status(StatusMap['Not Found'], { error: 'Choose an active published page.' });
      },
      {
        body: SetHomepageBodySchema,
        response: {
          [StatusMap.OK]: t.Object({ saved: t.Literal(true) }),
          [StatusMap['Not Found']]: ErrorResponseSchema,
        },
        detail: { tags: ['Public site'], summary: 'Set or clear the public homepage' },
      },
    );
}
