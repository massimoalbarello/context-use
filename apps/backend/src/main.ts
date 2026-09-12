import type { SQL } from 'bun';
import { createApp } from '#app.ts';
import { createSqliteDatabase, createSqliteReader } from '#db/client.ts';
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
import { MAX_RECORD_DELIVERY_BYTES } from '#models/records/delivery-contract.generated.ts';
import { AssetImportsRepository } from '#repositories/assets/imports.ts';
import { AssetsRepository } from '#repositories/assets/repository.ts';
import { EntitiesRepository } from '#repositories/entities/repository.ts';
import { FrontendAssetsRepository } from '#repositories/frontend-assets/repository.ts';
import { HealthRepository } from '#repositories/health/repository.ts';
import { HypermediaRepository } from '#repositories/hypermedia/repository.ts';
import { HypermediaRetrievalRepository } from '#repositories/hypermedia-retrieval/repository.ts';
import { KnowledgePagesRepository } from '#repositories/knowledge-pages/repository.ts';
import { KnowledgeProfilesRepository } from '#repositories/knowledge-profiles/repository.ts';
import { McpClientAuthorizationsRepository } from '#repositories/mcp-client-authorizations/repository.ts';
import { OwnerRegistrationRepository } from '#repositories/owner-registration/repository.ts';
import { RecordsRepository } from '#repositories/records/repository.ts';
import { RecordSyncsRepository } from '#repositories/syncs/repository.ts';
import { AssetTransferCapabilities } from '#routes/mcp/assets/transfer-capabilities.ts';
import { createContextUseMcpServer } from '#routes/mcp/server.ts';
import { AssetImportsService } from '#services/assets/imports.ts';
import { AssetsService } from '#services/assets/service.ts';
import { EntitiesService } from '#services/entities/service.ts';
import { FrontendAssetsService } from '#services/frontend-assets/service.ts';
import { HealthService } from '#services/health/service.ts';
import { HypermediaService } from '#services/hypermedia/service.ts';
import { HypermediaRetrievalService } from '#services/hypermedia-retrieval/service.ts';
import { KnowledgePagesService } from '#services/knowledge-pages/service.ts';
import { KnowledgeProfilesService } from '#services/knowledge-profiles/service.ts';
import { McpClientAuthorizationsService } from '#services/mcp-client-authorizations/service.ts';
import { OwnerRegistrationService } from '#services/owner-registration/service.ts';
import { RecordsService } from '#services/records/service.ts';
import { RecordSyncsService } from '#services/syncs/service.ts';

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
let recordsDatabase: SQL | undefined;
let assetImportsDatabase: SQL | undefined;
let retrievalDatabase: SQL | undefined;

try {
  await runMigrations({ db: database });

  const storage = createLocalStorage({ dataFolder: env.DATA_FOLDER });
  retrievalDatabase = createSqliteReader({ dataFolder: env.DATA_FOLDER });
  const retrievalRepository = new HypermediaRetrievalRepository({
    database: retrievalDatabase,
    storage,
  });
  const retrievalService = new HypermediaRetrievalService({
    retrieval: retrievalRepository,
    hypermedia: new HypermediaRepository(retrievalDatabase),
  });
  assetImportsDatabase = await createSqliteDatabase({ dataFolder: env.DATA_FOLDER });
  const assetImportsService = new AssetImportsService({
    imports: new AssetImportsRepository(assetImportsDatabase),
    storage,
  });
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
  const hypermediaService = new HypermediaService({
    hypermedia: new HypermediaRepository(database),
  });
  const ownerRegistrationService = new OwnerRegistrationService(
    new OwnerRegistrationRepository(database),
  );
  // Bun SQLite exposes in-flight transactions to unrelated queries on the same connection.
  // RecordsRepository serializes its own operations; other capabilities use the primary connection.
  recordsDatabase = await createSqliteDatabase({ dataFolder: env.DATA_FOLDER });
  const recordsRepository = new RecordsRepository(recordsDatabase);
  const recordsService = new RecordsService({ records: recordsRepository, storage });
  const syncsService = new RecordSyncsService({
    syncs: new RecordSyncsRepository(database),
  });
  const pagesService = new KnowledgePagesService({
    pages: pagesRepository,
    storage,
  });
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
        retrievalService,
        pagesService,
        profilesService,
        recordsService,
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
    assetImportsService,
    auth,
    assetsService,
    assetTransferCapabilities,
    frontendAssetsService,
    entitiesService,
    healthService,
    hypermediaService,
    retrievalService,
    mcpClientAuthorizationsService,
    mcpServerUrl: mcpServerUrl({ baseUrl: env.BASE_URL }),
    mcpTransport,
    ownerRegistrationService,
    pagesService,
    profilesService,
    recordsService,
    syncsService,
  }).onStop(async () => {
    await Promise.all([
      database.close(),
      recordsDatabase?.close(),
      retrievalDatabase?.close(),
      assetImportsDatabase?.close(),
    ]);
  });
  const { server } = app.listen({
    port: env.PORT,
    hostname: '0.0.0.0',
    maxRequestBodySize:
      Math.max(MAX_ASSET_BYTES, MAX_KNOWLEDGE_PAGE_BYTES, MAX_RECORD_DELIVERY_BYTES) +
      REQUEST_BODY_OVERHEAD_BYTES,
  });

  logger.info(`listening on ${server!.url.origin}`);
} catch (error) {
  await Promise.all([
    database.close(),
    recordsDatabase?.close(),
    retrievalDatabase?.close(),
    assetImportsDatabase?.close(),
  ]);
  throw error;
}
