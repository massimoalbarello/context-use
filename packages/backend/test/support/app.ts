import type { AssetFacesServiceContract } from '#services/assets/faces.ts';
import type { HypermediaServiceContract } from '#services/hypermedia/service.ts';
import type {
  RecordDeliveryAcceptanceContract,
  RecordResourcesServiceContract,
} from '#services/records/service.ts';
import type {
  RecordSyncAuthenticationContract,
  RecordSyncsServiceContract,
} from '#services/syncs/service.ts';

function unexpectedCall(): never {
  throw new Error('Unexpected hypermedia service call');
}

export const unusedHypermediaService: HypermediaServiceContract = {
  entityNeighborhood: unexpectedCall,
  pages: unexpectedCall,
};

export const unusedRecordsService: RecordDeliveryAcceptanceContract &
  RecordResourcesServiceContract = {
  accept: unexpectedCall,
  findResource: unexpectedCall,
  listResources: unexpectedCall,
  filterOptions: unexpectedCall,
};

export const unusedRecordSyncsService: RecordSyncAuthenticationContract &
  RecordSyncsServiceContract = {
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
  retryBatch: unexpectedCall,
  images: unexpectedCall,
  processSavedAsset: () => Promise.resolve(),
  preparePortrait: () => Promise.resolve(),
};
