import type { Auth } from '#lib/auth/better-auth.ts';
import type { McpTransportContract } from '#lib/mcp/transport.ts';
import type { AssetTransferCapabilitiesContract } from '#routes/mcp/assets/transfer-capabilities.ts';
import type { KnowledgeProfilesServiceContract } from '#services/knowledge-profiles/service.ts';
import type { McpClientAuthorizationsServiceContract } from '#services/mcp-client-authorizations/service.ts';

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
