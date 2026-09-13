import type { Database } from 'bun:sqlite';
import type { FaceAnalyzer } from '@repo/backend/lib/face-analysis/analyzer';
import type { Storage } from '@repo/backend/lib/storage/storage';
import { AssetsRepository } from '@repo/backend/repositories/assets/repository';
import { EntitiesRepository } from '@repo/backend/repositories/entities/repository';
import { FacesRepository } from '@repo/backend/repositories/faces/repository';
import { HealthRepository } from '@repo/backend/repositories/health/repository';
import { HypermediaRepository } from '@repo/backend/repositories/hypermedia/repository';
import { HypermediaRetrievalRepository } from '@repo/backend/repositories/hypermedia-retrieval/repository';
import { KnowledgePagesRepository } from '@repo/backend/repositories/knowledge-pages/repository';
import { KnowledgeProfilesRepository } from '@repo/backend/repositories/knowledge-profiles/repository';
import { RecordsRepository } from '@repo/backend/repositories/records/repository';
import { AssetFacesService } from '@repo/backend/services/assets/faces';
import { AssetsService } from '@repo/backend/services/assets/service';
import { EntitiesService } from '@repo/backend/services/entities/service';
import { HealthService } from '@repo/backend/services/health/service';
import { HypermediaService } from '@repo/backend/services/hypermedia/service';
import { HypermediaRetrievalService } from '@repo/backend/services/hypermedia-retrieval/service';
import { KnowledgePagesService } from '@repo/backend/services/knowledge-pages/service';
import { KnowledgeProfilesService } from '@repo/backend/services/knowledge-profiles/service';
import { RecordsService } from '@repo/backend/services/records/service';
import type { SQL } from 'bun';
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
    }),
    pagesService: new KnowledgePagesService({ pages, storage }),
    profilesService: new KnowledgeProfilesService(new KnowledgeProfilesRepository(database)),
    recordsService: new RecordsService({ records: new RecordsRepository(database), storage }),
  };
}
