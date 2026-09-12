import { Elysia } from 'elysia';
import { API_PATH } from '#lib/api-path.ts';
import type { Auth } from '#lib/auth/better-auth.ts';
import { createAssetReadableIdController } from '#routes/api/assets/[assetReadableId]/controller.ts';
import { createAssetsController } from '#routes/api/assets/controller.ts';
import { createAuthController } from '#routes/api/auth/controller.ts';
import { createEntityReadableIdController } from '#routes/api/entities/[entityReadableId]/controller.ts';
import { createEntitiesController } from '#routes/api/entities/controller.ts';
import { createHealthController } from '#routes/api/health/controller.ts';
import { createHypermediaController } from '#routes/api/hypermedia/controller.ts';
import { createHypermediaSearchController } from '#routes/api/hypermedia/search/controller.ts';
import { createMcpClientsController } from '#routes/api/mcp/clients/controller.ts';
import { createOwnerRegistrationController } from '#routes/api/owner-registration/controller.ts';
import { createPageReadableIdController } from '#routes/api/pages/[pageReadableId]/controller.ts';
import { createPagesController } from '#routes/api/pages/controller.ts';
import { createKnowledgeProfileController } from '#routes/api/profile/controller.ts';
import { createRecordReadableIdController } from '#routes/api/records/[recordReadableId]/controller.ts';
import { createRecordsController } from '#routes/api/records/controller.ts';
import { createRecordSyncsController } from '#routes/api/syncs/controller.ts';
import type { AssetsServiceContract } from '#services/assets/service.ts';
import type { EntitiesServiceContract } from '#services/entities/service.ts';
import type { HealthServiceContract } from '#services/health/service.ts';
import type { HypermediaServiceContract } from '#services/hypermedia/service.ts';
import type { HypermediaRetrievalServiceContract } from '#services/hypermedia-retrieval/service.ts';
import type { KnowledgePagesServiceContract } from '#services/knowledge-pages/service.ts';
import type { KnowledgeProfilesServiceContract } from '#services/knowledge-profiles/service.ts';
import type { McpClientAuthorizationsServiceContract } from '#services/mcp-client-authorizations/service.ts';
import type { OwnerRegistrationServiceContract } from '#services/owner-registration/service.ts';
import type { RecordResourcesServiceContract } from '#services/records/service.ts';
import type { RecordSyncsServiceContract } from '#services/syncs/service.ts';
import { createAssetFacesController } from './assets/[assetReadableId]/faces/controller.ts';
import { createEntityImagesController } from './entities/[entityReadableId]/images/controller.ts';
import { createFaceRecognitionController } from './face-recognition/controller.ts';

// The `/api` prefix is applied here, so child controllers keep bare path strings.
export function createApiController({
  auth,
  assetsService,
  entitiesService,
  healthService,
  hypermediaService,
  retrievalService,
  mcpClientAuthorizationsService,
  mcpServerUrl,
  ownerRegistrationService,
  pagesService,
  profilesService,
  recordsService,
  syncsService,
}: {
  auth: Auth;
  assetsService: AssetsServiceContract;
  entitiesService: EntitiesServiceContract;
  healthService: HealthServiceContract;
  hypermediaService: HypermediaServiceContract;
  retrievalService: HypermediaRetrievalServiceContract;
  mcpClientAuthorizationsService: McpClientAuthorizationsServiceContract;
  mcpServerUrl: string;
  ownerRegistrationService: OwnerRegistrationServiceContract;
  pagesService: KnowledgePagesServiceContract;
  profilesService: KnowledgeProfilesServiceContract;
  recordsService: RecordResourcesServiceContract;
  syncsService: RecordSyncsServiceContract;
}) {
  return new Elysia({ prefix: API_PATH })
    .use(createAuthController({ auth }))
    .use(createOwnerRegistrationController({ ownerRegistrationService }))
    .use(
      createMcpClientsController({
        auth,
        clientAuthorizationsService: mcpClientAuthorizationsService,
        mcpServerUrl,
      }),
    )
    .use(createAssetsController({ auth, assetsService }))
    .use(createAssetFacesController({ auth, faces: assetsService.faces }))
    .use(createEntityImagesController({ auth, faces: assetsService.faces }))
    .use(createFaceRecognitionController({ auth, faces: assetsService.faces }))
    .use(createAssetReadableIdController({ auth, assetsService }))
    .use(createEntitiesController({ auth, entitiesService }))
    .use(createEntityReadableIdController({ auth, entitiesService }))
    .use(createHypermediaSearchController({ auth, retrievalService }))
    .use(createHypermediaController({ auth, hypermediaService, retrievalService }))
    .use(createPagesController({ auth, pagesService }))
    .use(createPageReadableIdController({ auth, pagesService }))
    .use(createRecordsController({ auth, recordsService }))
    .use(createRecordReadableIdController({ auth, recordsService }))
    .use(createRecordSyncsController({ auth, syncsService }))
    .use(createKnowledgeProfileController({ auth, profilesService }))
    .use(createHealthController({ healthService }));
}
