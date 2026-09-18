import type { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { createOpenSync, type OpenSyncRuntime } from '@context-use/open-sync';
import type { SQL } from 'bun';
import { createApp } from '#backend/app.ts';
import {
  createSqliteDatabase,
  createSqliteReader,
  createSynchronousSqliteDatabase,
} from '#backend/db/client.ts';
import { runMigrations } from '#backend/db/migrate.ts';
import { loadAuthSecret } from '#backend/lib/auth/auth-secret.ts';
import { createAuth, mcpServerUrl } from '#backend/lib/auth/better-auth.ts';
import { fetchClientMetadataResource } from '#backend/lib/auth/client-metadata-resource.ts';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { loadEnv } from '#backend/lib/env.ts';
import { LocalFaceAnalyzer } from '#backend/lib/face-analysis/local-analyzer.ts';
import { createLogger } from '#backend/lib/logger.ts';
import { createMcpTransport } from '#backend/lib/mcp/transport.ts';
import { BACKEND_ENVIRONMENT } from '#backend/lib/runtime-config.ts';
import { createLocalStorage } from '#backend/lib/storage/client.ts';
import { LocalStorage } from '#backend/lib/storage/local-storage.ts';
import { MAX_ASSET_BYTES } from '#backend/models/assets/model.ts';
import { MAX_KNOWLEDGE_PAGE_BYTES } from '#backend/models/knowledge-pages/model.ts';
import { LOCAL_RECORD_DESTINATION } from '#backend/models/syncs/managed.ts';
import { ApiKeysRepository } from '#backend/repositories/api-keys/repository.ts';
import { AssetsRepository } from '#backend/repositories/assets/repository.ts';
import { EntitiesRepository } from '#backend/repositories/entities/repository.ts';
import { FacesRepository } from '#backend/repositories/faces/repository.ts';
import { FrontendAssetsRepository } from '#backend/repositories/frontend-assets/repository.ts';
import { HealthRepository } from '#backend/repositories/health/repository.ts';
import { HypermediaGraphRepository } from '#backend/repositories/hypermedia-graph/repository.ts';
import { HypermediaRetrievalRepository } from '#backend/repositories/hypermedia-retrieval/repository.ts';
import { KnowledgePagesRepository } from '#backend/repositories/knowledge-pages/repository.ts';
import { KnowledgeProfilesRepository } from '#backend/repositories/knowledge-profiles/repository.ts';
import { McpClientAuthorizationsRepository } from '#backend/repositories/mcp-client-authorizations/repository.ts';
import { OwnerRegistrationRepository } from '#backend/repositories/owner-registration/repository.ts';
import { RecordsRepository } from '#backend/repositories/records/repository.ts';
import { AssetTransferCapabilities } from '#backend/routes/mcp/assets/transfer-capabilities.ts';
import { createContextUseMcpServer } from '#backend/routes/mcp/server.ts';
import { syncProviderLocation } from '#backend/routes/sync-callbacks.ts';
import { ApiKeysService } from '#backend/services/api-keys/service.ts';
import { AssetFacesService } from '#backend/services/assets/faces.ts';
import { AssetsService } from '#backend/services/assets/service.ts';
import { EntitiesService } from '#backend/services/entities/service.ts';
import { FrontendAssetsService } from '#backend/services/frontend-assets/service.ts';
import { HealthService } from '#backend/services/health/service.ts';
import { HypermediaGraphService } from '#backend/services/hypermedia-graph/service.ts';
import { HypermediaRetrievalService } from '#backend/services/hypermedia-retrieval/service.ts';
import { KnowledgePagesService } from '#backend/services/knowledge-pages/service.ts';
import { KnowledgeProfilesService } from '#backend/services/knowledge-profiles/service.ts';
import { McpClientAuthorizationsService } from '#backend/services/mcp-client-authorizations/service.ts';
import { OwnerRegistrationService } from '#backend/services/owner-registration/service.ts';
import { RecordsService } from '#backend/services/records/service.ts';
import { SyncCatalog } from '#backend/services/syncs/catalog.ts';
import { localRecordDestination } from '#backend/services/syncs/destination.ts';
import { syncEventLogger } from '#backend/services/syncs/logging.ts';
import { ManagedSyncsService } from '#backend/services/syncs/managed.ts';
import { syncProviders } from '#backend/services/syncs/providers/index.ts';

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
let sync: OpenSyncRuntime | undefined;
let recordsDatabase: SQL | undefined;
let retrievalDatabase: SQL | undefined;
let facesDatabase: Database | undefined;
const faceAnalyzer = new LocalFaceAnalyzer({ dataFolder: env.DATA_FOLDER });

try {
  await runMigrations({ db: database });

  const storage = createLocalStorage({ dataFolder: env.DATA_FOLDER });
  retrievalDatabase = createSqliteReader({ dataFolder: env.DATA_FOLDER });
  const retrievalRepository = new HypermediaRetrievalRepository({
    database: retrievalDatabase,
    storage,
  });
  const graphRepository = new HypermediaGraphRepository(retrievalDatabase);
  const graphService = new HypermediaGraphService({ graph: graphRepository });
  const retrievalService = new HypermediaRetrievalService({
    retrieval: retrievalRepository,
  });
  const assetsRepository = new AssetsRepository(database);
  facesDatabase = createSynchronousSqliteDatabase({ dataFolder: env.DATA_FOLDER });
  const entitiesRepository = new EntitiesRepository(database);
  const facesService = new AssetFacesService({
    repository: new FacesRepository(facesDatabase),
    assets: assetsRepository,
    entities: entitiesRepository,
    storage,
    crops: new LocalStorage(join(env.DATA_FOLDER, 'face-crops')),
    analyzer: faceAnalyzer,
  });
  const assetsService = new AssetsService({
    faces: facesService,
    assets: assetsRepository,
    storage,
  });
  const assetTransferCapabilities = new AssetTransferCapabilities({ baseUrl: env.BASE_URL });
  const frontendAssetsService = new FrontendAssetsService(new FrontendAssetsRepository());
  const pagesRepository = new KnowledgePagesRepository(database);
  const entitiesService = new EntitiesService({
    assets: assetsRepository,
    onPersonPortraitAvailable: (input) => facesService.preparePortrait(input),
    entities: entitiesRepository,
    pages: pagesRepository,
  });
  const healthService = new HealthService(new HealthRepository(database));
  const ownerRegistrationService = new OwnerRegistrationService(
    new OwnerRegistrationRepository(database),
  );
  // Bun SQLite exposes in-flight transactions to unrelated queries on the same connection.
  // RecordsRepository serializes its own operations; other capabilities use the primary connection.
  recordsDatabase = await createSqliteDatabase({ dataFolder: env.DATA_FOLDER });
  const recordsRepository = new RecordsRepository(recordsDatabase);
  const recordsService = new RecordsService({ records: recordsRepository, storage });
  const apiKeysService = new ApiKeysService({
    keys: new ApiKeysRepository(database),
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
    nibrunHostname: env.NIBRUN_HOSTNAME,
    secret: authSecret.value,
    fetchClientMetadataResource,
  });

  const catalog = new SyncCatalog(syncProviders);
  sync = await createOpenSync({
    onEvent: syncEventLogger(createLogger('sync')),
    dataDirectory: join(env.DATA_FOLDER, 'open-sync'),
    publicUrl: new URL('/api/open-sync', env.BASE_URL).href,
    authorize: async (request) => {
      const session = await auth.getSession({ headers: request.headers });
      return session?.user.id === OWNER_USER_ID
        ? { actorId: session.user.id, ownerId: session.user.id }
        : null;
    },
    canConfigureProviders: (scope) =>
      Promise.resolve(scope.actorId === OWNER_USER_ID && scope.actorId === scope.ownerId),
    authorizationRedirect: ({ service, outcome }) =>
      syncProviderLocation({ providerId: service, outcome }),
    definitions: catalog.definitions,
    destinationTypes: {
      [LOCAL_RECORD_DESTINATION]: localRecordDestination({
        upsertRecord: (input) => recordsService.upsert(input),
        ownerId: OWNER_USER_ID,
        definitions: catalog.definitions,
      }),
    },
  });
  const managedSyncsService = new ManagedSyncsService({
    sync,
    countRecords: (input) => recordsService.countResources(input),
    catalog,
  });
  const app = createApp({
    managedSyncsService,
    syncFetch: sync.fetch,
    auth,
    assetsService,
    assetTransferCapabilities,
    frontendAssetsService,
    entitiesService,
    healthService,
    graphService,
    retrievalService,
    mcpClientAuthorizationsService,
    mcpServerUrl: mcpServerUrl({ baseUrl: env.BASE_URL }),
    mcpTransport,
    ownerRegistrationService,
    pagesService,
    profilesService,
    recordsService,
    apiKeysService,
  }).onStop(async () => {
    await sync?.close();
    await facesService.close();
    await faceAnalyzer.close();
    await Promise.all([
      database.close(),
      recordsDatabase?.close(),
      retrievalDatabase?.close(),
      facesDatabase?.close(),
    ]);
  });
  const { server } = app.listen({
    port: env.PORT,
    hostname: '0.0.0.0',
    maxRequestBodySize:
      Math.max(MAX_ASSET_BYTES, MAX_KNOWLEDGE_PAGE_BYTES) + REQUEST_BODY_OVERHEAD_BYTES,
  });

  logger.info(`listening on ${server!.url.origin}`);
  facesService.startProcessing();
  sync.start();
  const stop = () => {
    void app.stop();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
} catch (error) {
  await sync?.close();
  await faceAnalyzer.close();
  await Promise.all([
    database.close(),
    recordsDatabase?.close(),
    retrievalDatabase?.close(),
    facesDatabase?.close(),
  ]);
  throw error;
}
