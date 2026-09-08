import type { McpServer } from '@modelcontextprotocol/server';
import { DEFAULT_HYPERMEDIA_SEARCH_LIMIT } from '#models/hypermedia-retrieval/model.ts';
import type { McpClientAuthorizationPrincipal } from '#models/mcp-client-authorizations/model.ts';
import { MCP_READ_TOOL_ANNOTATIONS } from '#routes/mcp/tool-annotations.ts';
import { mcpToolSuccess } from '#routes/mcp/tool-result.ts';
import type { HypermediaRetrievalServiceContract } from '#services/hypermedia-retrieval/service.ts';
import {
  mcpHypermediaRetrievalResult,
  SearchHypermediaInputSchema,
  SearchHypermediaOutputSchema,
} from './model.ts';

export function registerHypermediaRetrievalTools({
  server,
  principal,
  retrievalService,
}: {
  server: McpServer;
  principal: McpClientAuthorizationPrincipal;
  retrievalService: Pick<HypermediaRetrievalServiceContract, 'search'>;
}): void {
  server.registerTool(
    'search_hypermedia',
    {
      title: 'Search hypermedia',
      description:
        'Retrieve the strongest lexical matches across active entities, knowledge pages, and assets. Use exact typed read tools to inspect plausible results; relevance does not prove identity or relationship.',
      inputSchema: SearchHypermediaInputSchema,
      outputSchema: SearchHypermediaOutputSchema,
      annotations: MCP_READ_TOOL_ANNOTATIONS,
    },
    async ({ query, resourceTypes, limit = DEFAULT_HYPERMEDIA_SEARCH_LIMIT }) => {
      const result = await retrievalService.search({
        ownerId: principal.ownerId,
        query,
        resourceTypes,
        limit,
      });
      return mcpToolSuccess({
        results: result.results.map(mcpHypermediaRetrievalResult),
        truncated: result.truncated,
      });
    },
  );
}
