import { openapi } from '@elysiajs/openapi';
import { Elysia } from 'elysia';
import { type Auth, sessionSecuritySchemes } from '#lib/auth/better-auth.ts';
import { elysiaErrorHandler } from '#lib/errors.ts';
import type { McpTransportContract } from '#lib/mcp/transport.ts';
import { createRequestResponsePlugin } from '#lib/request-response.ts';
import { createApiController } from '#routes/api/controller.ts';
import { createAuthDiscoveryController } from '#routes/auth-discovery/controller.ts';
import {
  createFrontendAssetsController,
  createFrontendFallbackController,
} from '#routes/controller.ts';
import type { AssetTransferCapabilitiesContract } from '#routes/mcp/assets/transfer-capabilities.ts';
import { createAssetTransferController } from '#routes/mcp/assets/transfer-controller.ts';
import { createMcpController } from '#routes/mcp/controller.ts';
import type { AssetsServiceContract } from '#services/assets/service.ts';
import type { EntitiesServiceContract } from '#services/entities/service.ts';
import type { FrontendAssetsServiceContract } from '#services/frontend-assets/service.ts';
import type { HealthServiceContract } from '#services/health/service.ts';
import type { HypermediaServiceContract } from '#services/hypermedia/service.ts';
import type { KnowledgePagesServiceContract } from '#services/knowledge-pages/service.ts';
import type { KnowledgeProfilesServiceContract } from '#services/knowledge-profiles/service.ts';
import type { McpClientAuthorizationsServiceContract } from '#services/mcp-client-authorizations/service.ts';
import type { OwnerRegistrationServiceContract } from '#services/owner-registration/service.ts';

// Pinned rather than left to the plugin's default: the frontend links to it and the dev
// server proxies it.
const OPENAPI_PATH = '/openapi';

export function createApp({
  auth,
  assetsService,
  assetTransferCapabilities,
  frontendAssetsService,
  entitiesService,
  healthService,
  hypermediaService,
  mcpClientAuthorizationsService,
  mcpServerUrl,
  mcpTransport,
  ownerRegistrationService,
  pagesService,
  profilesService,
}: {
  auth: Auth;
  assetsService: AssetsServiceContract;
  assetTransferCapabilities: AssetTransferCapabilitiesContract;
  frontendAssetsService: FrontendAssetsServiceContract;
  entitiesService: EntitiesServiceContract;
  healthService: HealthServiceContract;
  hypermediaService: HypermediaServiceContract;
  mcpClientAuthorizationsService: McpClientAuthorizationsServiceContract;
  mcpServerUrl: string;
  mcpTransport: McpTransportContract;
  ownerRegistrationService: OwnerRegistrationServiceContract;
  pagesService: KnowledgePagesServiceContract;
  profilesService: KnowledgeProfilesServiceContract;
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
          ],
          components: {
            securitySchemes: sessionSecuritySchemes,
          },
        },
      }),
    )
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
        healthService,
        hypermediaService,
        mcpClientAuthorizationsService,
        mcpServerUrl,
        ownerRegistrationService,
        pagesService,
        profilesService,
      }),
    )
    .onStop(() => mcpTransport.close())
    .use(createFrontendFallbackController({ frontendAssetsService }));
}
