import { Elysia, StatusMap, t } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { createAuthPlugin } from '#backend/lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#backend/lib/errors.ts';
import { KnowledgePageRevisionParamsSchema } from '#backend/routes/api/pages/[pageReadableId]/revisions/model.ts';
import { publicPageHtml } from '#backend/routes/public/page.tsx';
import type { PublicResourcesServiceContract } from '#backend/services/public-resources/service.ts';

export function createPagePublicationPreviewController({
  auth,
  publicResourcesService,
  publicSiteName,
}: {
  auth: Auth;
  publicResourcesService: PublicResourcesServiceContract;
  publicSiteName?: string;
}) {
  return new Elysia()
    .use(createAuthPlugin({ auth }))
    .guard({ auth: true, response: { [StatusMap.Unauthorized]: ErrorResponseSchema } })
    .get(
      '/pages/:pageReadableId/revisions/:revisionNumber/publication-preview',
      async ({ params, user, status, set, request }) => {
        set.headers['cache-control'] = 'private, no-store';
        const content = await publicResourcesService.pagePreview({
          ownerId: user.id,
          readableId: params.pageReadableId,
          revisionNumber: params.revisionNumber,
        });
        return content
          ? status(StatusMap.OK, {
              revisionNumber: params.revisionNumber,
              html: publicPageHtml({
                ...content,
                siteName: publicSiteName,
                linkTarget: '_top',
                fragmentBase: 'about:srcdoc',
                origin: new URL(request.url).origin,
              }),
            })
          : status(StatusMap['Not Found'], {
              error:
                'Publication preview unavailable. The revision or its required public references may no longer be available.',
            });
      },
      {
        detail: { tags: ['Pages'], summary: 'Preview a saved revision as a public page' },
        params: KnowledgePageRevisionParamsSchema,
        response: {
          [StatusMap.OK]: t.Object({ revisionNumber: t.Integer({ minimum: 1 }), html: t.String() }),
          [StatusMap['Not Found']]: ErrorResponseSchema,
        },
      },
    );
}
