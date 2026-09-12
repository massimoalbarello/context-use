import type { HypermediaGraphServiceContract } from '#services/hypermedia-graph/service.ts';
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

export const unusedHypermediaGraphService: HypermediaGraphServiceContract = {
  neighborhoods: unexpectedCall,
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
