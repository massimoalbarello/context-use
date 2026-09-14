import type { Database } from 'bun:sqlite';
import type { SQL } from 'bun';
import type { FaceAnalyzer } from '#backend/lib/face-analysis/analyzer.ts';
import type { Storage } from '#backend/lib/storage/storage.ts';
import { AssetsRepository } from '#backend/repositories/assets/repository.ts';
import { EntitiesRepository } from '#backend/repositories/entities/repository.ts';
import { FacesRepository } from '#backend/repositories/faces/repository.ts';
import { HealthRepository } from '#backend/repositories/health/repository.ts';
import { HypermediaGraphRepository } from '#backend/repositories/hypermedia-graph/repository.ts';
import { HypermediaRetrievalRepository } from '#backend/repositories/hypermedia-retrieval/repository.ts';
import { KnowledgePagesRepository } from '#backend/repositories/knowledge-pages/repository.ts';
import { KnowledgeProfilesRepository } from '#backend/repositories/knowledge-profiles/repository.ts';
import { RecordsRepository } from '#backend/repositories/records/repository.ts';
import { AssetFacesService } from '#backend/services/assets/faces.ts';
import { AssetsService } from '#backend/services/assets/service.ts';
import { EntitiesService } from '#backend/services/entities/service.ts';
import { HealthService } from '#backend/services/health/service.ts';
import { HypermediaGraphService } from '#backend/services/hypermedia-graph/service.ts';
import { HypermediaRetrievalService } from '#backend/services/hypermedia-retrieval/service.ts';
import { KnowledgePagesService } from '#backend/services/knowledge-pages/service.ts';
import { KnowledgeProfilesService } from '#backend/services/knowledge-profiles/service.ts';
import { RecordsService } from '#backend/services/records/service.ts';
import { createDemoFaces } from './faces';

/** Demo composition only. Seeding is sequential; serving uses a read-only connection. */
export function createDemoResources({
  database,
  facesDatabase,
  storage,
  crops,
  analyzer,
}: {
  database: SQL;
  facesDatabase: Database;
  storage: Storage;
  crops: Storage;
  analyzer: FaceAnalyzer;
}) {
  const assets = new AssetsRepository(database);
  const entities = new EntitiesRepository(database);
  const pages = new KnowledgePagesRepository(database);
  const graph = new HypermediaGraphRepository(database);
  const facesService = new AssetFacesService({
    repository: new FacesRepository(facesDatabase),
    assets,
    entities,
    storage,
    crops,
    analyzer,
  });
  const faces = createDemoFaces(facesService);
  return {
    facesService,
    assetsService: new AssetsService({
      assets,
      storage,
      faces,
    }),
    entitiesService: new EntitiesService({
      assets,
      onPersonPortraitAvailable: (input) => faces.preparePortrait(input),
      entities,
      pages,
    }),
    healthService: new HealthService(new HealthRepository(database)),
    graphService: new HypermediaGraphService({ graph }),
    retrievalService: new HypermediaRetrievalService({
      retrieval: new HypermediaRetrievalRepository({ database, storage }),
    }),
    pagesService: new KnowledgePagesService({ pages, storage }),
    profilesService: new KnowledgeProfilesService(new KnowledgeProfilesRepository(database)),
    recordsService: new RecordsService({ records: new RecordsRepository(database), storage }),
  };
}
