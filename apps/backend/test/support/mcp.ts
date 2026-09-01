import type { Auth } from '#lib/auth/better-auth.ts';
import type { McpTransportContract } from '#lib/mcp/transport.ts';
import type { McpConnectionsServiceContract } from '#services/mcp-connections/service.ts';

function unexpectedCall(): never {
  throw new Error('Unexpected MCP dependency call');
}

export const unusedMcpProtection: Auth['protectMcpRequest'] = () => async () =>
  new Response(null, { status: 500 });

export const unusedMcpConnectionsService: McpConnectionsServiceContract = {
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
