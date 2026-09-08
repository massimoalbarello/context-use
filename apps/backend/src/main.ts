import { createApp } from '#app.ts';
import { createSqliteDatabase } from '#db/client.ts';
import { runMigrations } from '#db/migrate.ts';
import { loadAuthSecret } from '#lib/auth/auth-secret.ts';
import { createAuth, mcpServerUrl } from '#lib/auth/better-auth.ts';
import { fetchClientMetadataResource } from '#lib/auth/client-metadata-resource.ts';
import { loadEnv } from '#lib/env.ts';
import { createLogger } from '#lib/logger.ts';
import { createMcpTransport } from '#lib/mcp/transport.ts';
import {
  loadOpenConnectorReceiverRuntimeConfig,
  OPEN_CONNECTOR_ENVIRONMENT,
} from '#lib/open-connector/config.ts';
import { BACKEND_ENVIRONMENT } from '#lib/runtime-config.ts';
import { createLocalStorage } from '#lib/storage/client.ts';
import { MAX_ASSET_BYTES } from '#models/assets/model.ts';
import { MAX_KNOWLEDGE_PAGE_BYTES } from '#models/knowledge-pages/model.ts';
import { MAX_OPEN_CONNECTOR_DELIVERY_BYTES } from '#models/open-connector/model.ts';
import { AssetsRepository } from '#repositories/assets/repository.ts';
import { EntitiesRepository } from '#repositories/entities/repository.ts';
import { FrontendAssetsRepository } from '#repositories/frontend-assets/repository.ts';
import { HealthRepository } from '#repositories/health/repository.ts';
import { HypermediaRepository } from '#repositories/hypermedia/repository.ts';
import { KnowledgePagesRepository } from '#repositories/knowledge-pages/repository.ts';
import { KnowledgeProfilesRepository } from '#repositories/knowledge-profiles/repository.ts';
import { McpClientAuthorizationsRepository } from '#repositories/mcp-client-authorizations/repository.ts';
import { OpenConnectorRecordsRepository } from '#repositories/open-connector/repository.ts';
import { OwnerRegistrationRepository } from '#repositories/owner-registration/repository.ts';
import { AssetTransferCapabilities } from '#routes/mcp/assets/transfer-capabilities.ts';
import { createContextUseMcpServer } from '#routes/mcp/server.ts';
import { AssetsService } from '#services/assets/service.ts';
import { EntitiesService } from '#services/entities/service.ts';
import { FrontendAssetsService } from '#services/frontend-assets/service.ts';
import { HealthService } from '#services/health/service.ts';
import { HypermediaService } from '#services/hypermedia/service.ts';
import { KnowledgePagesService } from '#services/knowledge-pages/service.ts';
import { KnowledgeProfilesService } from '#services/knowledge-profiles/service.ts';
import { McpClientAuthorizationsService } from '#services/mcp-client-authorizations/service.ts';
import { OpenConnectorRecordsService } from '#services/open-connector/service.ts';
import { OpenConnectorIngestionWorker } from '#services/open-connector/worker.ts';
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
let openConnectorIngestionWorker: OpenConnectorIngestionWorker | undefined;

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
  const hypermediaService = new HypermediaService(new HypermediaRepository(database));
  const ownerRegistrationRepository = new OwnerRegistrationRepository(database);
  const ownerRegistrationService = new OwnerRegistrationService(ownerRegistrationRepository);
  const openConnectorRecordsRepository = new OpenConnectorRecordsRepository(database);
  const openConnectorRecordsService = new OpenConnectorRecordsService({
    records: openConnectorRecordsRepository,
    ownerRegistration: ownerRegistrationRepository,
  });
  const openConnectorReceiver = await loadOpenConnectorReceiverRuntimeConfig({
    dataFolder: env.DATA_FOLDER,
  });
  if (openConnectorReceiver) {
    const binding = await openConnectorRecordsService.bindIntegration({
      integrationId: openConnectorReceiver.integrationId,
      ownerId: openConnectorReceiver.ownerId,
    });
    if (binding.state === 'owner_not_found') {
      throw new Error(
        `${OPEN_CONNECTOR_ENVIRONMENT.ownerId} must identify the fully claimed Context Use owner. Complete passkey registration before enabling record sync.`,
      );
    }
    if (binding.state === 'conflict') {
      throw new Error(
        `${OPEN_CONNECTOR_ENVIRONMENT.receiverId} is already bound to a different Context Use owner.`,
      );
    }

    const credentialState = await openConnectorRecordsService.verifyReceiverToken({
      integrationId: openConnectorReceiver.integrationId,
      ownerId: openConnectorReceiver.ownerId,
      receiverToken: openConnectorReceiver.bearerToken,
      initializeIfMissing: binding.state === 'bound',
    });
    if (credentialState === 'missing') {
      throw new Error(
        'The durable open-connector receiver token is missing. Restore the original token or run `bun run open-connector:setup -- register` to rotate it explicitly.',
      );
    }
    if (credentialState === 'mismatch') {
      throw new Error(
        'The configured open-connector receiver token does not match its durable registration. Restore the registered token or run `bun run open-connector:setup -- register` to rotate it explicitly.',
      );
    }
    if (credentialState === 'integration_not_found') {
      throw new Error('The open-connector receiver credential lost its trusted owner binding.');
    }

    if (openConnectorReceiver.bearerTokenSource.kind === 'environment') {
      logger.info(
        `using open-connector receiver token from ${OPEN_CONNECTOR_ENVIRONMENT.receiverToken}`,
      );
    } else if (openConnectorReceiver.bearerTokenSource.kind === 'generated-file') {
      logger.info(
        `generated open-connector receiver token at ${openConnectorReceiver.bearerTokenSource.path}`,
      );
    } else {
      logger.info(
        `using open-connector receiver token from ${openConnectorReceiver.bearerTokenSource.path}`,
      );
    }
  }
  // Accepted jobs no longer depend on receiver credentials. Recover durable work when the route
  // is disabled, but do not keep an otherwise unused process polling SQLite.
  if (openConnectorReceiver || (await openConnectorRecordsRepository.hasUnfinishedJobs())) {
    openConnectorIngestionWorker = new OpenConnectorIngestionWorker({
      records: openConnectorRecordsRepository,
      stopWhenDrained: !openConnectorReceiver,
    });
    openConnectorIngestionWorker.start();
  }
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
        profilesService,
        recordsService: openConnectorRecordsService,
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
    hypermediaService,
    mcpClientAuthorizationsService,
    mcpServerUrl: mcpServerUrl({ baseUrl: env.BASE_URL }),
    mcpTransport,
    openConnectorReceiver: openConnectorReceiver
      ? {
          integrationId: openConnectorReceiver.integrationId,
          ownerId: openConnectorReceiver.ownerId,
          receiverToken: openConnectorReceiver.bearerToken,
          recordsService: openConnectorRecordsService,
        }
      : undefined,
    ownerRegistrationService,
    pagesService,
    profilesService,
  }).onStop(async () => {
    await openConnectorIngestionWorker?.stop();
    await database.close();
  });
  const { server } = app.listen({
    port: env.PORT,
    hostname: '0.0.0.0',
    maxRequestBodySize:
      Math.max(MAX_ASSET_BYTES, MAX_KNOWLEDGE_PAGE_BYTES, MAX_OPEN_CONNECTOR_DELIVERY_BYTES) +
      REQUEST_BODY_OVERHEAD_BYTES,
  });

  logger.info(`listening on ${server!.url.origin}`);
} catch (error) {
  await openConnectorIngestionWorker?.stop();
  await database.close();
  throw error;
}
