import { openapi } from '@elysiajs/openapi';
import { Elysia } from 'elysia';
import { type Auth, sessionSecuritySchemes } from '#lib/auth/better-auth.ts';
import { elysiaErrorHandler } from '#lib/errors.ts';
import { createRequestResponsePlugin } from '#lib/request-response.ts';
import { createApiController } from '#routes/api/controller.ts';
import {
  createFrontendAssetsController,
  createFrontendFallbackController,
} from '#routes/controller.ts';
import type { AssetsServiceContract } from '#services/assets.service.ts';
import type { EntitiesServiceContract } from '#services/entities.service.ts';
import type { HealthServiceContract } from '#services/health.service.ts';
import type { KnowledgePagesServiceContract } from '#services/knowledge-pages.service.ts';

// Pinned rather than left to the plugin's default: the frontend links to it and the dev
// server proxies it.
const OPENAPI_PATH = '/openapi';

export function createApp({
  auth,
  assetsService,
  entitiesService,
  healthService,
  pagesService,
}: {
  auth: Auth;
  assetsService: AssetsServiceContract;
  entitiesService: EntitiesServiceContract;
  healthService: HealthServiceContract;
  pagesService: KnowledgePagesServiceContract;
}) {
  // The frontend's files go on first, ahead of every global hook — see the comment on the
  // controller itself for why the order matters.
  return new Elysia()
    .use(createFrontendAssetsController({ assetsService }))
    .onError(elysiaErrorHandler)
    .use(createRequestResponsePlugin())
    .use(
      openapi({
        path: OPENAPI_PATH,
        documentation: {
          info: {
            title: 'Context Use API',
            description: 'Entities and linked knowledge pages served alongside the dashboard.',
            version: '1.0.0',
          },
          tags: [
            {
              name: 'Entities',
              description: 'Stable coordinates mentioned by knowledge pages.',
            },
            {
              name: 'Pages',
              description: 'Versioned Markdown knowledge pages and their links.',
            },
            {
              name: 'Health',
              description: 'Liveness of the server and its database.',
            },
          ],
          components: {
            securitySchemes: sessionSecuritySchemes,
          },
        },
      }),
    )
    .use(createApiController({ auth, entitiesService, healthService, pagesService }))
    .use(createFrontendFallbackController({ assetsService }));
}
