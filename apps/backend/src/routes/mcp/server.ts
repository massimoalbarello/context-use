import { McpServer } from '@modelcontextprotocol/server';
import type { McpClientAuthorizationPrincipal } from '#models/mcp-client-authorizations/model.ts';
import type { AssetsServiceContract } from '#services/assets/service.ts';
import type { EntitiesServiceContract } from '#services/entities/service.ts';
import type { KnowledgePagesServiceContract } from '#services/knowledge-pages/service.ts';
import { registerAssetTools } from './assets/tools.ts';
import type { AssetTransferCapabilitiesContract } from './assets/transfer-capabilities.ts';
import { registerEntityTools } from './entities/tools.ts';
import { registerKnowledgePageTools } from './pages/tools.ts';

export const MCP_SUPPORTED_LEGACY_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18'] as const;

export function createContextUseMcpServer({
  principal,
  assetsService,
  entitiesService,
  pagesService,
  transferCapabilities,
}: {
  principal: McpClientAuthorizationPrincipal;
  assetsService: AssetsServiceContract;
  entitiesService: EntitiesServiceContract;
  pagesService: KnowledgePagesServiceContract;
  transferCapabilities: AssetTransferCapabilitiesContract;
}): McpServer {
  const server = new McpServer(
    { name: 'context-use', version: '1.0.0' },
    { supportedProtocolVersions: [...MCP_SUPPORTED_LEGACY_PROTOCOL_VERSIONS] },
  );
  registerAssetTools({ server, principal, assetsService, transferCapabilities });
  registerEntityTools({ server, principal, entitiesService });
  registerKnowledgePageTools({ server, principal, pagesService });
  return server;
}
