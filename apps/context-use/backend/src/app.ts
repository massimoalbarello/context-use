import { openapi } from '@elysiajs/openapi';
import { Elysia } from 'elysia';
import { type Auth, sessionSecuritySchemes } from '#backend/lib/auth/better-auth.ts';
import { elysiaErrorHandler } from '#backend/lib/errors.ts';
import type { McpTransportContract } from '#backend/lib/mcp/transport.ts';
import { createRequestResponsePlugin } from '#backend/lib/request-response.ts';
import { apiKeySecuritySchemes } from '#backend/routes/api/api-keys/model.ts';
import { createApiController } from '#backend/routes/api/controller.ts';
import { createAuthDiscoveryController } from '#backend/routes/auth-discovery/controller.ts';
import {
  createFrontendAssetsController,
  createFrontendFallbackController,
} from '#backend/routes/controller.ts';
import type { AssetTransferCapabilitiesContract } from '#backend/routes/mcp/assets/transfer-capabilities.ts';
import { createAssetTransferController } from '#backend/routes/mcp/assets/transfer-controller.ts';
import { createMcpController } from '#backend/routes/mcp/controller.ts';
import { createPublicController } from '#backend/routes/public/controller.ts';
import { createSyncCallbacks, type SyncFetch } from '#backend/routes/sync-callbacks.ts';
import type {
  ApiKeyAuthenticationContract,
  ApiKeysServiceContract,
} from '#backend/services/api-keys/service.ts';
import type { AssetsServiceContract } from '#backend/services/assets/service.ts';
import type { EntitiesServiceContract } from '#backend/services/entities/service.ts';
import type { FrontendAssetsServiceContract } from '#backend/services/frontend-assets/service.ts';
import type { HealthServiceContract } from '#backend/services/health/service.ts';
import type { HistoryServiceContract } from '#backend/services/history/service.ts';
import type { HypermediaGraphServiceContract } from '#backend/services/hypermedia-graph/service.ts';
import type { HypermediaRetrievalServiceContract } from '#backend/services/hypermedia-retrieval/service.ts';
import type { KnowledgePagesServiceContract } from '#backend/services/knowledge-pages/service.ts';
import type { KnowledgeProfilesServiceContract } from '#backend/services/knowledge-profiles/service.ts';
import type { McpClientAuthorizationsServiceContract } from '#backend/services/mcp-client-authorizations/service.ts';
import type { OwnerRegistrationServiceContract } from '#backend/services/owner-registration/service.ts';
import type { PublicResourcesServiceContract } from '#backend/services/public-resources/service.ts';
import type { PublicationApprovalServiceContract } from '#backend/services/publications/approval-service.ts';
import type {
  RecordResourcesServiceContract,
  RecordsIngestionContract,
} from '#backend/services/records/service.ts';
import type { ManagedSyncsServiceContract } from '#backend/services/syncs/managed.ts';

// Pinned rather than left to the plugin's default: the frontend links to it and the dev
// server proxies it.
const OPENAPI_PATH = '/openapi';

export function createApp({
  auth,
  assetsService,
  assetTransferCapabilities,
  frontendAssetsService,
  entitiesService,
  historyService,
  healthService,
  graphService,
  retrievalService,
  mcpClientAuthorizationsService,
  mcpServerUrl,
  mcpTransport,
  ownerRegistrationService,
  pagesService,
  profilesService,
  publicationApprovalService,
  publicResourcesService,
  recordsService,
  apiKeysService,
  managedSyncsService,
  syncFetch,
}: {
  auth: Auth;
  syncFetch: SyncFetch;
  managedSyncsService: ManagedSyncsServiceContract;
  assetsService: AssetsServiceContract;
  assetTransferCapabilities: AssetTransferCapabilitiesContract;
  frontendAssetsService: FrontendAssetsServiceContract;
  entitiesService: EntitiesServiceContract;
  historyService: HistoryServiceContract;
  healthService: HealthServiceContract;
  graphService: HypermediaGraphServiceContract;
  retrievalService: HypermediaRetrievalServiceContract;
  mcpClientAuthorizationsService: McpClientAuthorizationsServiceContract;
  mcpServerUrl: string;
  mcpTransport: McpTransportContract;
  ownerRegistrationService: OwnerRegistrationServiceContract;
  pagesService: KnowledgePagesServiceContract;
  profilesService: KnowledgeProfilesServiceContract;
  publicationApprovalService: PublicationApprovalServiceContract;
  publicResourcesService: PublicResourcesServiceContract;
  recordsService: RecordsIngestionContract & RecordResourcesServiceContract;
  apiKeysService: ApiKeyAuthenticationContract & ApiKeysServiceContract;
}) {
  // The frontend's files go on first, ahead of every global hook — see the comment on the
  // controller itself for why the order matters.
  return new Elysia()
    .use(createFrontendAssetsController({ frontendAssetsService }))
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
              name: 'Publications',
              description: 'Publication status and fresh owner passkey approval.',
            },
            {
              name: 'Assets',
              description: 'Uploaded files embedded in or attached to knowledge pages.',
            },
            {
              name: 'Entities',
              description: 'Stable coordinates mentioned by knowledge pages.',
            },
            {
              name: 'Pages',
              description: 'Versioned Markdown knowledge pages and their links.',
            },
            {
              name: 'Records',
              description: 'Markdown records delivered by trusted external services.',
            },
            {
              name: 'MCP clients',
              description: 'Owner-approved MCP clients and their authorization lifecycle.',
            },
            {
              name: 'Owner registration',
              description: 'Whether this Context Use instance has been claimed with a passkey.',
            },
            {
              name: 'Profile',
              description: 'The entity representing the owner of this knowledge base.',
            },
            {
              name: 'Health',
              description: 'Liveness of the server and its database.',
            },
            {
              name: 'Hypermedia',
              description: 'Bounded resource neighborhoods and their connected knowledge pages.',
            },
            {
              name: 'API keys',
              description: 'Credentials authorized to access native write APIs.',
            },
          ],
          components: {
            securitySchemes: {
              ...sessionSecuritySchemes,
              ...apiKeySecuritySchemes,
            },
          },
        },
      }),
    )
    .use(createPublicController({ publicResourcesService }))
    .use(createSyncCallbacks({ auth, fetch: syncFetch, syncs: managedSyncsService }))
    .use(createAuthDiscoveryController({ auth }))
    .use(
      createAssetTransferController({
        assetsService,
        transferCapabilities: assetTransferCapabilities,
      }),
    )
    .use(
      createMcpController({
        auth,
        clientAuthorizationsService: mcpClientAuthorizationsService,
        transport: mcpTransport,
      }),
    )
    .use(
      createApiController({
        auth,
        assetsService,
        entitiesService,
        historyService,
        healthService,
        graphService,
        retrievalService,
        mcpClientAuthorizationsService,
        mcpServerUrl,
        ownerRegistrationService,
        pagesService,
        profilesService,
        publicationApprovalService,
        recordsService,
        apiKeysService,
        managedSyncsService,
      }),
    )
    .onStop(() => mcpTransport.close())
    .use(createFrontendFallbackController({ frontendAssetsService }));
}
