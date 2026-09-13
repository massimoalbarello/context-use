import type { Auth } from '#backend/lib/auth/better-auth.ts';
import type { McpTransportContract } from '#backend/lib/mcp/transport.ts';
import type { AssetTransferCapabilitiesContract } from '#backend/routes/mcp/assets/transfer-capabilities.ts';
import type { HypermediaRetrievalServiceContract } from '#backend/services/hypermedia-retrieval/service.ts';
import type { KnowledgeProfilesServiceContract } from '#backend/services/knowledge-profiles/service.ts';
import type { McpClientAuthorizationsServiceContract } from '#backend/services/mcp-client-authorizations/service.ts';
import type { RecordResourcesServiceContract } from '#backend/services/records/service.ts';

function unexpectedCall(): never {
  throw new Error('Unexpected MCP dependency call');
}

export const unusedMcpProtection: Auth['protectMcpRequest'] = () => async () =>
  new Response(null, { status: 500 });

export const unusedMcpClientAuthorizationsService: McpClientAuthorizationsServiceContract = {
  authorizationClient: unexpectedCall,
  approve: unexpectedCall,
  list: unexpectedCall,
  rename: unexpectedCall,
  archive: unexpectedCall,
  authenticate: unexpectedCall,
};

export const unusedMcpTransport: McpTransportContract = {
  fetch: unexpectedCall,
  close: () => Promise.resolve(),
};

export const unusedHypermediaRetrievalService: HypermediaRetrievalServiceContract = {
  search: unexpectedCall,
};
export const unusedMcpRecordsService: Pick<RecordResourcesServiceContract, 'findResource'> = {
  findResource: unexpectedCall,
};

export const unusedKnowledgeProfilesService: KnowledgeProfilesServiceContract = {
  create: unexpectedCall,
  find: unexpectedCall,
};

export const unusedAssetTransferCapabilities: AssetTransferCapabilitiesContract = {
  issueUpload: unexpectedCall,
  issueDownload: unexpectedCall,
  consumeUpload: unexpectedCall,
  consumeDownload: unexpectedCall,
};

export const testMcpServerUrl = 'https://context-use.nibrun.app/mcp';
