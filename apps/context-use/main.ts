import type { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { createApp } from '@repo/backend/app';
import { MAX_ASSET_BYTES } from '@repo/backend/asset';
import {
  createSqliteDatabase,
  createSqliteReader,
  createSynchronousSqliteDatabase,
} from '@repo/backend/db/client';
import { runMigrations } from '@repo/backend/db/migrate';
import { loadAuthSecret } from '@repo/backend/lib/auth/auth-secret';
import { createAuth, mcpServerUrl } from '@repo/backend/lib/auth/better-auth';
import { fetchClientMetadataResource } from '@repo/backend/lib/auth/client-metadata-resource';
import { loadEnv } from '@repo/backend/lib/env';
import { LocalFaceAnalyzer } from '@repo/backend/lib/face-analysis/local-analyzer';
import { createLogger } from '@repo/backend/lib/logger';
import { createMcpTransport } from '@repo/backend/lib/mcp/transport';
import { createLocalStorage } from '@repo/backend/lib/storage/client';
import { LocalStorage } from '@repo/backend/lib/storage/local-storage';
import { MAX_RECORD_DELIVERY_BYTES } from '@repo/backend/models/records/delivery-contract.generated';
import { MAX_KNOWLEDGE_PAGE_BYTES } from '@repo/backend/page';
import { AssetsRepository } from '@repo/backend/repositories/assets/repository';
import { EntitiesRepository } from '@repo/backend/repositories/entities/repository';
import { FacesRepository } from '@repo/backend/repositories/faces/repository';
import { FrontendAssetsRepository } from '@repo/backend/repositories/frontend-assets/repository';
import { HealthRepository } from '@repo/backend/repositories/health/repository';
import { HypermediaRepository } from '@repo/backend/repositories/hypermedia/repository';
import { HypermediaRetrievalRepository } from '@repo/backend/repositories/hypermedia-retrieval/repository';
import { KnowledgePagesRepository } from '@repo/backend/repositories/knowledge-pages/repository';
import { KnowledgeProfilesRepository } from '@repo/backend/repositories/knowledge-profiles/repository';
import { McpClientAuthorizationsRepository } from '@repo/backend/repositories/mcp-client-authorizations/repository';
import { OwnerRegistrationRepository } from '@repo/backend/repositories/owner-registration/repository';
import { RecordsRepository } from '@repo/backend/repositories/records/repository';
import { RecordSyncsRepository } from '@repo/backend/repositories/syncs/repository';
import { AssetTransferCapabilities } from '@repo/backend/routes/mcp/assets/transfer-capabilities';
import { createContextUseMcpServer } from '@repo/backend/routes/mcp/server';
import { BACKEND_ENVIRONMENT } from '@repo/backend/runtime-config';
import { AssetFacesService } from '@repo/backend/services/assets/faces';
import { AssetsService } from '@repo/backend/services/assets/service';
import { EntitiesService } from '@repo/backend/services/entities/service';
import { FrontendAssetsService } from '@repo/backend/services/frontend-assets/service';
import { HealthService } from '@repo/backend/services/health/service';
import { HypermediaService } from '@repo/backend/services/hypermedia/service';
import { HypermediaRetrievalService } from '@repo/backend/services/hypermedia-retrieval/service';
import { KnowledgePagesService } from '@repo/backend/services/knowledge-pages/service';
import { KnowledgeProfilesService } from '@repo/backend/services/knowledge-profiles/service';
import { McpClientAuthorizationsService } from '@repo/backend/services/mcp-client-authorizations/service';
import { OwnerRegistrationService } from '@repo/backend/services/owner-registration/service';
import { RecordsService } from '@repo/backend/services/records/service';
import { RecordSyncsService } from '@repo/backend/services/syncs/service';
import type { SQL } from 'bun';

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
      Math.max(MAX_ASSET_BYTES, MAX_KNOWLEDGE_PAGE_BYTES, MAX_RECORD_DELIVERY_BYTES) +
      REQUEST_BODY_OVERHEAD_BYTES,
  });

  logger.info(`listening on ${server!.url.origin}`);
  if (Bun.isStandaloneExecutable) {
    void faceAnalyzer.prepare().catch((error) => {
      logger.warn('Face models could not be prepared; image processing will retry.', error);
    });
  }
} catch (error) {
  await faceAnalyzer.close();
  await Promise.all([
    database.close(),
    recordsDatabase?.close(),
    retrievalDatabase?.close(),
    facesDatabase?.close(),
  ]);
  throw error;
}
