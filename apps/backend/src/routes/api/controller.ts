import { Elysia } from 'elysia';
import { API_PATH } from '#lib/api-path.ts';
import type { Auth } from '#lib/auth/better-auth.ts';
import { createAssetReadableIdController } from '#routes/api/assets/[assetReadableId]/controller.ts';
import { createAssetsController } from '#routes/api/assets/controller.ts';
import { createAuthController } from '#routes/api/auth/controller.ts';
import { createEntityReadableIdController } from '#routes/api/entities/[entityReadableId]/controller.ts';
import { createEntitiesController } from '#routes/api/entities/controller.ts';
import { createHealthController } from '#routes/api/health/controller.ts';
import { createMcpConnectionsController } from '#routes/api/mcp/connections/controller.ts';
import { createOwnerRegistrationController } from '#routes/api/owner-registration/controller.ts';
import { createPageReadableIdController } from '#routes/api/pages/[pageReadableId]/controller.ts';
import { createPagesController } from '#routes/api/pages/controller.ts';
import { createKnowledgeProfileController } from '#routes/api/profile/controller.ts';
import type { AssetsServiceContract } from '#services/assets/service.ts';
import type { EntitiesServiceContract } from '#services/entities/service.ts';
import type { HealthServiceContract } from '#services/health/service.ts';
import type { KnowledgePagesServiceContract } from '#services/knowledge-pages/service.ts';
import type { KnowledgeProfilesServiceContract } from '#services/knowledge-profiles/service.ts';
import type { McpConnectionsServiceContract } from '#services/mcp-connections/service.ts';
import type { OwnerRegistrationServiceContract } from '#services/owner-registration/service.ts';

// The `/api` prefix is applied here, so child controllers keep bare path strings.
export function createApiController({
  auth,
  assetsService,
  entitiesService,
  healthService,
  mcpConnectionsService,
  mcpServerUrl,
  ownerRegistrationService,
  pagesService,
  profilesService,
}: {
  auth: Auth;
  assetsService: AssetsServiceContract;
  entitiesService: EntitiesServiceContract;
  healthService: HealthServiceContract;
  mcpConnectionsService: McpConnectionsServiceContract;
  mcpServerUrl: string;
  ownerRegistrationService: OwnerRegistrationServiceContract;
  pagesService: KnowledgePagesServiceContract;
  profilesService: KnowledgeProfilesServiceContract;
}) {
  return new Elysia({ prefix: API_PATH })
    .use(createAuthController({ auth }))
    .use(createOwnerRegistrationController({ ownerRegistrationService }))
    .use(
      createMcpConnectionsController({
        auth,
        connectionsService: mcpConnectionsService,
        mcpServerUrl,
      }),
    )
    .use(createAssetsController({ auth, assetsService }))
    .use(createAssetReadableIdController({ auth, assetsService }))
    .use(createEntitiesController({ auth, entitiesService }))
    .use(createEntityReadableIdController({ auth, entitiesService }))
    .use(createPagesController({ auth, pagesService }))
    .use(createPageReadableIdController({ auth, pagesService }))
    .use(createKnowledgeProfileController({ auth, profilesService }))
    .use(createHealthController({ healthService }));
}
