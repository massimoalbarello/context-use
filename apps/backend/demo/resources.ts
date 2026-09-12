import type { Database } from 'bun:sqlite';
import type { SQL } from 'bun';
import type { FaceAnalyzer } from '#lib/face-analysis/analyzer.ts';
import type { Storage } from '#lib/storage/storage.ts';
import { AssetsRepository } from '#repositories/assets/repository.ts';
import { EntitiesRepository } from '#repositories/entities/repository.ts';
import { FacesRepository } from '#repositories/faces/repository.ts';
import { HealthRepository } from '#repositories/health/repository.ts';
import { HypermediaRepository } from '#repositories/hypermedia/repository.ts';
import { HypermediaRetrievalRepository } from '#repositories/hypermedia-retrieval/repository.ts';
import { KnowledgePagesRepository } from '#repositories/knowledge-pages/repository.ts';
import { KnowledgeProfilesRepository } from '#repositories/knowledge-profiles/repository.ts';
import { RecordsRepository } from '#repositories/records/repository.ts';
import { AssetFacesService } from '#services/assets/faces.ts';
import { AssetsService } from '#services/assets/service.ts';
import { EntitiesService } from '#services/entities/service.ts';
import { HealthService } from '#services/health/service.ts';
import { HypermediaService } from '#services/hypermedia/service.ts';
import { HypermediaRetrievalService } from '#services/hypermedia-retrieval/service.ts';
import { KnowledgePagesService } from '#services/knowledge-pages/service.ts';
import { KnowledgeProfilesService } from '#services/knowledge-profiles/service.ts';
import { RecordsService } from '#services/records/service.ts';
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
  const hypermedia = new HypermediaRepository(database);
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
    hypermediaService: new HypermediaService({ hypermedia }),
    retrievalService: new HypermediaRetrievalService({
      retrieval: new HypermediaRetrievalRepository({ database, storage }),
      hypermedia,
    }),
    pagesService: new KnowledgePagesService({ pages, storage }),
    profilesService: new KnowledgeProfilesService(new KnowledgeProfilesRepository(database)),
    recordsService: new RecordsService({ records: new RecordsRepository(database), storage }),
  };
}
