import type { OpenConnectorRecordsAcceptanceContract } from '#routes/integrations/open-connector/controller.ts';
import type { HypermediaServiceContract } from '#services/hypermedia/service.ts';
import type { OpenConnectorRecordResourcesServiceContract } from '#services/open-connector/service.ts';

function unexpectedCall(): never {
  throw new Error('Unexpected hypermedia service call');
}

export const unusedHypermediaService: HypermediaServiceContract = {
  resourceNeighborhood: unexpectedCall,
  pages: unexpectedCall,
};

export const unusedOpenConnectorRecordsService: OpenConnectorRecordsAcceptanceContract &
  OpenConnectorRecordResourcesServiceContract = {
  accept: unexpectedCall,
  authenticateDeliveryApiKey: unexpectedCall,
  findResource: unexpectedCall,
  listResources: unexpectedCall,
};
