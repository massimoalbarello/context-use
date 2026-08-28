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
import type { FilesServiceContract } from '#services/files.service.ts';
import type { HealthServiceContract } from '#services/health.service.ts';

// Pinned rather than left to the plugin's default: the frontend links to it and the dev
// server proxies it.
const OPENAPI_PATH = '/openapi';

export function createApp({
  auth,
  assetsService,
  filesService,
  healthService,
}: {
  auth: Auth;
  assetsService: AssetsServiceContract;
  filesService: FilesServiceContract;
  healthService: HealthServiceContract;
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
            title: 'Bun Full-Stack API',
            description: 'Everything this server answers, next to the frontend it also serves.',
            version: '1.0.0',
          },
          tags: [
            {
              name: 'Files',
              description: 'Upload, list, download and delete the signed-in user’s files.',
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
    .use(createApiController({ auth, filesService, healthService }))
    .use(createFrontendFallbackController({ assetsService }));
}
