import type {
  ApiKeyAuthenticationContract,
  ApiKeysServiceContract,
} from '#backend/services/api-keys/service.ts';
import type { AssetFacesServiceContract } from '#backend/services/assets/faces.ts';
import type { HistoryServiceContract } from '#backend/services/history/service.ts';
import type { HypermediaGraphServiceContract } from '#backend/services/hypermedia-graph/service.ts';
import type { PublicResourcesServiceContract } from '#backend/services/public-resources/service.ts';
import type { PublicationApprovalServiceContract } from '#backend/services/publications/approval-service.ts';
import type {
  RecordResourcesServiceContract,
  RecordsIngestionContract,
} from '#backend/services/records/service.ts';
import type { ManagedSyncsServiceContract } from '#backend/services/syncs/managed.ts';

function unexpectedCall(): never {
  throw new Error('Unexpected hypermedia service call');
}

export const unusedHypermediaGraphService: HypermediaGraphServiceContract = {
  neighborhoods: unexpectedCall,
  pages: unexpectedCall,
};

export const unusedRecordsService: RecordsIngestionContract & RecordResourcesServiceContract = {
  upsert: unexpectedCall,
  remove: unexpectedCall,
  findResource: unexpectedCall,
  listResources: unexpectedCall,
  filterOptions: unexpectedCall,
};

export const unusedApiKeysService: ApiKeyAuthenticationContract & ApiKeysServiceContract = {
  authenticate: unexpectedCall,
  create: unexpectedCall,
  list: unexpectedCall,
  revoke: unexpectedCall,
};

export const unusedAssetFacesService: AssetFacesServiceContract = {
  detail: unexpectedCall,
  process: unexpectedCall,
  annotate: unexpectedCall,
  crop: unexpectedCall,
  settings: unexpectedCall,
  saveThreshold: unexpectedCall,
  enqueue: unexpectedCall,
  processing: unexpectedCall,
  checkModel: unexpectedCall,
  retryFailed: unexpectedCall,
  images: unexpectedCall,
  notifyAssetSaved: () => {},
  preparePortrait: () => Promise.resolve(),
};

export const unusedManagedSyncsService: ManagedSyncsServiceContract = {
  list: unexpectedCall,
  configureApp: unexpectedCall,
  connect: unexpectedCall,
  completeConnection: unexpectedCall,
  update: unexpectedCall,
};
export const unusedSyncFetch = () => Promise.resolve(new Response(null, { status: 404 }));

export const unusedHistoryService: HistoryServiceContract = { list: unexpectedCall };

export const unusedPublicationApprovalService: PublicationApprovalServiceContract = {
  status: unexpectedCall,
  begin: unexpectedCall,
  complete: unexpectedCall,
};

export const unusedPublicResourcesService: PublicResourcesServiceContract = {
  assetContent: unexpectedCall,
  pageContent: unexpectedCall,
  recordContent: unexpectedCall,
  entityContent: unexpectedCall,
};
