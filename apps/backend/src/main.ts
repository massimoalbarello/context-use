import { createApp } from '#app.ts';
import { createSqliteDatabase } from '#db/client.ts';
import { runMigrations } from '#db/migrate.ts';
import { loadAuthSecret } from '#lib/auth/auth-secret.ts';
import { createAuth, mcpServerUrl } from '#lib/auth/better-auth.ts';
import { fetchClientMetadataResource } from '#lib/auth/client-metadata-resource.ts';
import { loadEnv } from '#lib/env.ts';
import { createLogger } from '#lib/logger.ts';
import { createMcpTransport } from '#lib/mcp/transport.ts';
import { BACKEND_ENVIRONMENT } from '#lib/runtime-config.ts';
import { createLocalStorage } from '#lib/storage/client.ts';
import { MAX_ASSET_BYTES } from '#models/assets/model.ts';
import { MAX_KNOWLEDGE_PAGE_BYTES } from '#models/knowledge-pages/model.ts';
import { AssetsRepository } from '#repositories/assets/repository.ts';
import { EntitiesRepository } from '#repositories/entities/repository.ts';
import { FrontendAssetsRepository } from '#repositories/frontend-assets/repository.ts';
import { HealthRepository } from '#repositories/health/repository.ts';
import { KnowledgePagesRepository } from '#repositories/knowledge-pages/repository.ts';
import { KnowledgeProfilesRepository } from '#repositories/knowledge-profiles/repository.ts';
import { McpClientAuthorizationsRepository } from '#repositories/mcp-client-authorizations/repository.ts';
import { OwnerRegistrationRepository } from '#repositories/owner-registration/repository.ts';
import { AssetTransferCapabilities } from '#routes/mcp/assets/transfer-capabilities.ts';
import { createContextUseMcpServer } from '#routes/mcp/server.ts';
import { AssetsService } from '#services/assets/service.ts';
import { EntitiesService } from '#services/entities/service.ts';
import { FrontendAssetsService } from '#services/frontend-assets/service.ts';
import { HealthService } from '#services/health/service.ts';
import { KnowledgePagesService } from '#services/knowledge-pages/service.ts';
import { KnowledgeProfilesService } from '#services/knowledge-profiles/service.ts';
import { McpClientAuthorizationsService } from '#services/mcp-client-authorizations/service.ts';
import { OwnerRegistrationService } from '#services/owner-registration/service.ts';

const BYTES_PER_KIBIBYTE = 1024;
const REQUEST_BODY_OVERHEAD_KIBIBYTES = 64;
const REQUEST_BODY_OVERHEAD_BYTES = REQUEST_BODY_OVERHEAD_KIBIBYTES * BYTES_PER_KIBIBYTE;

const env = loadEnv();
const authSecret = await loadAuthSecret({
  dataFolder: env.DATA_FOLDER,
  environmentSecret: env.BETTER_AUTH_SECRET,
});
const logger = createLogger('main');
if (authSecret.source.kind === 'environment') {
  logger.info(`using auth secret from ${BACKEND_ENVIRONMENT.authSecret}`);
} else if (authSecret.source.kind === 'generated-file') {
  logger.info(`generated auth secret at ${authSecret.source.path}`);
} else {
  logger.info(`using auth secret from ${authSecret.source.path}`);
}
const database = await createSqliteDatabase({ dataFolder: env.DATA_FOLDER });

try {
  await runMigrations({ db: database });

  const storage = createLocalStorage({ dataFolder: env.DATA_FOLDER });
  const assetsRepository = new AssetsRepository(database);
  const assetsService = new AssetsService({
    assets: assetsRepository,
    storage,
  });
  const assetTransferCapabilities = new AssetTransferCapabilities({ baseUrl: env.BASE_URL });
  const frontendAssetsService = new FrontendAssetsService(new FrontendAssetsRepository());
  const pagesRepository = new KnowledgePagesRepository(database);
  const entitiesService = new EntitiesService({
    assets: assetsRepository,
    entities: new EntitiesRepository(database),
    pages: pagesRepository,
  });
  const healthService = new HealthService(new HealthRepository(database));
  const ownerRegistrationService = new OwnerRegistrationService(
    new OwnerRegistrationRepository(database),
  );
  const pagesService = new KnowledgePagesService({ pages: pagesRepository, storage });
  const profilesService = new KnowledgeProfilesService(new KnowledgeProfilesRepository(database));
  const mcpClientAuthorizationsService = new McpClientAuthorizationsService(
    new McpClientAuthorizationsRepository(database),
  );
  const mcpTransport = createMcpTransport({
    createServer: ({ principal }) =>
      createContextUseMcpServer({
        principal,
        assetsService,
        entitiesService,
        pagesService,
        transferCapabilities: assetTransferCapabilities,
      }),
  });
  const auth = createAuth({
    database,
    baseUrl: env.BASE_URL,
    secret: authSecret.value,
    fetchClientMetadataResource,
  });

  const app = createApp({
    auth,
    assetsService,
    assetTransferCapabilities,
    frontendAssetsService,
    entitiesService,
    healthService,
    mcpClientAuthorizationsService,
    mcpServerUrl: mcpServerUrl({ baseUrl: env.BASE_URL }),
    mcpTransport,
    ownerRegistrationService,
    pagesService,
    profilesService,
  }).onStop(async () => {
    await database.close();
  });
  const { server } = app.listen({
    port: env.PORT,
    hostname: '0.0.0.0',
    maxRequestBodySize:
      Math.max(MAX_ASSET_BYTES, MAX_KNOWLEDGE_PAGE_BYTES) + REQUEST_BODY_OVERHEAD_BYTES,
  });

  logger.info(`listening on ${server!.url.origin}`);
} catch (error) {
  await database.close();
  throw error;
}
