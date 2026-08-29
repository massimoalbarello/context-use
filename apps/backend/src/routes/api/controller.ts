import { Elysia } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { RoutePrefix } from '#lib/routes/prefixes.ts';
import { createAuthController } from '#routes/api/auth/controller.ts';
import { createEntityReadableIdController } from '#routes/api/entities/[entityReadableId]/controller.ts';
import { createEntitiesController } from '#routes/api/entities/controller.ts';
import { createHealthController } from '#routes/api/health/controller.ts';
import { createPageReadableIdController } from '#routes/api/pages/[pageReadableId]/controller.ts';
import { createPagesController } from '#routes/api/pages/controller.ts';
import type { EntitiesServiceContract } from '#services/entities.service.ts';
import type { HealthServiceContract } from '#services/health.service.ts';
import type { KnowledgePagesServiceContract } from '#services/knowledge-pages.service.ts';

// The `/api` prefix is applied here, so child controllers keep bare path strings.
export function createApiController({
  auth,
  entitiesService,
  healthService,
  pagesService,
}: {
  auth: Auth;
  entitiesService: EntitiesServiceContract;
  healthService: HealthServiceContract;
  pagesService: KnowledgePagesServiceContract;
}) {
  return new Elysia({ prefix: RoutePrefix.Api })
    .use(createAuthController({ auth }))
    .use(createEntitiesController({ auth, entitiesService }))
    .use(createEntityReadableIdController({ auth, entitiesService }))
    .use(createPagesController({ auth, pagesService }))
    .use(createPageReadableIdController({ auth, pagesService }))
    .use(createHealthController({ healthService }));
}
