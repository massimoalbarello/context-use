import { expect, test } from 'bun:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpTransport } from '#lib/mcp/transport.ts';
import type { EntityDetail } from '#models/entities/model.ts';
import type { McpClientAuthorizationPrincipal } from '#models/mcp-client-authorizations/model.ts';
import {
  createContextUseMcpServer,
  MCP_SUPPORTED_LEGACY_PROTOCOL_VERSIONS,
} from '#routes/mcp/server.ts';
import type { AssetsServiceContract } from '#services/assets/service.ts';
import type { EntitiesServiceContract } from '#services/entities/service.ts';
import type { KnowledgePagesServiceContract } from '#services/knowledge-pages/service.ts';
import {
  unusedAssetTransferCapabilities,
  unusedKnowledgeProfilesService,
} from '../../support/mcp.ts';

const LEGACY_PROTOCOL_VERSION = '2025-06-18';
const NOW = '2026-09-01T12:00:00.000Z';
const ACCESS_TOKEN_LIFETIME_SECONDS = 60;
const MILLISECONDS_PER_SECOND = 1000;

function unexpectedCall(): never {
  throw new Error('Unexpected service call');
}

const entity: EntityDetail = {
  id: 'internal-entity-id',
  readableId: 'luca-bianchi',
  name: 'Luca Bianchi',
  description: 'Researcher and collaborator',
  isSelf: false,
  image: null,
  pages: [],
  createdAt: NOW,
  updatedAt: NOW,
};

const entitiesService: EntitiesServiceContract = {
  create: unexpectedCall,
  list: unexpectedCall,
  detail: async () => entity,
  update: unexpectedCall,
  setImage: unexpectedCall,
  removeImage: unexpectedCall,
  archive: unexpectedCall,
};

const assetsService: AssetsServiceContract = {
  create: unexpectedCall,
  list: unexpectedCall,
  detail: unexpectedCall,
  updateName: unexpectedCall,
  archive: unexpectedCall,
  content: unexpectedCall,
};

const pagesService: KnowledgePagesServiceContract = {
  create: unexpectedCall,
  list: unexpectedCall,
  preview: unexpectedCall,
  detail: unexpectedCall,
  update: unexpectedCall,
  archive: unexpectedCall,
  rebuildIndex: unexpectedCall,
};

const principal: McpClientAuthorizationPrincipal = {
  ownerId: 'owner-id',
  clientAuthorizationId: 'client-authorization-id',
  clientAuthorizationName: 'Codex',
};

test('authenticated 2025-06-18 clients can initialize and call the same tools', async () => {
  expect(MCP_SUPPORTED_LEGACY_PROTOCOL_VERSIONS).toContain(LEGACY_PROTOCOL_VERSION);

  const serverTransport = createMcpTransport({
    createServer: ({ principal: authenticatedPrincipal }) =>
      createContextUseMcpServer({
        principal: authenticatedPrincipal,
        assetsService,
        entitiesService,
        pagesService,
        profilesService: unusedKnowledgeProfilesService,
        transferCapabilities: unusedAssetTransferCapabilities,
      }),
  });
  const clientTransport = new StreamableHTTPClientTransport(
    new URL('https://context-use.test/mcp'),
    {
      fetch: async (...[input, init]) =>
        await serverTransport.fetch({
          request: input instanceof Request ? input : new Request(input.toString(), init),
          accessToken: 'access-token',
          oauthClientId: 'oauth-client-id',
          scopes: ['context-use'],
          expiresAt:
            Math.floor(Date.now() / MILLISECONDS_PER_SECOND) + ACCESS_TOKEN_LIFETIME_SECONDS,
          resource: new URL('https://context-use.test/mcp'),
          principal,
        }),
    },
  );
  const client = new Client(
    { name: 'older-codex', version: '1.0.0' },
    { supportedProtocolVersions: [LEGACY_PROTOCOL_VERSION] },
  );

  try {
    await client.connect(clientTransport);
    expect(client.getProtocolEra()).toBe('legacy');
    expect(clientTransport.protocolVersion).toBe(LEGACY_PROTOCOL_VERSION);

    const result = await client.callTool({
      name: 'read_entity',
      arguments: { address: 'context-use://entity/luca-bianchi' },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(
      expect.objectContaining({
        address: 'context-use://entity/luca-bianchi',
        readableId: 'luca-bianchi',
        name: 'Luca Bianchi',
      }),
    );
  } finally {
    await client.close();
    await serverTransport.close();
  }
});
