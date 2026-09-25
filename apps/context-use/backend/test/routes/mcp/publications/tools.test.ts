import { expect, test } from 'bun:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { createMcpTransport } from '#backend/lib/mcp/transport.ts';
import { registerPublicationTools } from '#backend/routes/mcp/publications/tools.ts';
import type { PublicationApprovalServiceContract } from '#backend/services/publications/approval-service.ts';

type StatusService = Pick<PublicationApprovalServiceContract, 'status'>;
type PublicationStatus = NonNullable<Awaited<ReturnType<StatusService['status']>>>;

const OWNER_ID = 'owner-a';
const NOW = '2026-09-01T12:00:00.000Z';
const MILLISECONDS_PER_SECOND = 1000;

async function withClient({
  publicationStatusService,
  run,
}: {
  publicationStatusService: StatusService;
  run: (client: Client) => Promise<void>;
}): Promise<void> {
  const transport = createMcpTransport({
    createServer: ({ principal }) => {
      const server = new McpServer({ name: 'publication-test', version: '1.0.0' });
      registerPublicationTools({ server, principal, publicationStatusService });
      return server;
    },
  });
  const clientTransport = new StreamableHTTPClientTransport(new URL('https://context.test/mcp'), {
    fetch: async (...[input, init]) =>
      transport.fetch({
        request: input instanceof Request ? input : new Request(input.toString(), init),
        accessToken: 'test-token',
        oauthClientId: 'test-client',
        scopes: ['mcp'],
        expiresAt: Math.floor(Date.now() / MILLISECONDS_PER_SECOND) + 60,
        resource: new URL('https://context.test/mcp'),
        principal: {
          ownerId: OWNER_ID,
          clientAuthorizationId: 'authorization-a',
          clientAuthorizationName: 'Publication reader',
        },
      }),
  });
  const client = new Client({ name: 'publication-test', version: '1.0.0' });
  try {
    await client.connect(clientTransport);
    await run(client);
  } finally {
    await client.close();
    await transport.close();
  }
}

test.each(['page', 'entity', 'asset'] as const)(
  'MCP %s status maps the authenticated owner and preserves active, withdrawn and private states',
  async (resourceType) => {
    const states = [
      { publicId: `${resourceType}_public-handle`, publishedAt: NOW },
      { publicId: `${resourceType}_public-handle`, publishedAt: null },
      { publicId: null, publishedAt: null },
    ];
    for (const state of states) {
      const publication: PublicationStatus =
        resourceType === 'page'
          ? { ...state, resourceType, publishedRevisionNumber: state.publishedAt ? 2 : null }
          : { ...state, resourceType };
      await withClient({
        publicationStatusService: {
          status: (input) => {
            expect(input).toEqual({ ownerId: OWNER_ID, resourceType, readableId: 'project' });
            // The transport must allowlist the status fields, even if a service result grows.
            return Promise.resolve({ ...publication, ownerId: OWNER_ID, id: 'internal-id' });
          },
        },
        run: async (client) => {
          const result = await client.callTool({
            name: 'read_publication_status',
            arguments: { address: `context-use://${resourceType}/project`, ownerId: 'owner-b' },
          });
          expect(result.isError).not.toBe(true);
          expect(result.structuredContent).toEqual(publication);
          expect(result.content).toHaveLength(1);
          const content = result.content[0];
          expect(content?.type).toBe('text');
          if (content?.type === 'text') {
            expect(JSON.parse(content.text)).toEqual(publication);
          }
        },
      });
    }
  },
);

test('MCP absent and foreign resources use the same not_found result', async () => {
  await withClient({
    publicationStatusService: {
      status: ({ ownerId, resourceType, readableId }) => {
        expect(ownerId).toBe(OWNER_ID);
        expect(resourceType).toBe('page');
        expect(['missing', 'foreign']).toContain(readableId);
        return Promise.resolve(null);
      },
    },
    run: async (client) => {
      for (const readableId of ['missing', 'foreign']) {
        const result = await client.callTool({
          name: 'read_publication_status',
          arguments: { address: `context-use://page/${readableId}` },
        });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toEqual({
          error: { code: 'not_found', message: 'Resource not found.' },
        });
      }
    },
  });
});

test('publication status rejects records, fragments and noncanonical coordinates before service calls', async () => {
  await withClient({
    publicationStatusService: {
      status: () => {
        throw new Error('Invalid coordinates reached the service');
      },
    },
    run: async (client) => {
      for (const address of [
        'context-use://record/project',
        'context-use://page/project#heading',
        'context-use://page/',
        'project',
        'https://context.test/public/pages/page_public-handle',
      ]) {
        const result = await client.callTool({
          name: 'read_publication_status',
          arguments: { address },
        });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).not.toContain('Invalid coordinates reached the service');
      }
    },
  });
});

test('the published status schema explains active publication without exposing approval internals', async () => {
  await withClient({
    publicationStatusService: { status: () => Promise.resolve(null) },
    run: async (client) => {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(1);
      const tool = tools[0]!;
      expect(tool.name).toBe('read_publication_status');
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(tool.inputSchema.required).toEqual(['address']);
      expect(tool.description).toContain('even when its latest revision is private');
      const schema = JSON.stringify(tool.outputSchema);
      expect(schema).toContain('null means private, even with a retained publicId');
      expect(schema).toContain('publishedRevisionNumber');
      for (const field of [
        'ownerId',
        'revisionId',
        'expectedState',
        'challenge',
        'credential',
        'approvalId',
      ]) {
        expect(JSON.stringify(tool)).not.toContain(field);
      }
    },
  });
});
