import type { HypermediaServiceContract } from '#services/hypermedia/service.ts';

function unexpectedCall(): never {
  throw new Error('Unexpected hypermedia service call');
}

export const unusedHypermediaService: HypermediaServiceContract = {
  resourceNeighborhood: unexpectedCall,
  pages: unexpectedCall,
};
