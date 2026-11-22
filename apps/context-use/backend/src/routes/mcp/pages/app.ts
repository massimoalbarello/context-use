import { RESOURCE_MIME_TYPE, registerAppResource } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { McpClientAuthorizationPrincipal } from '#backend/models/mcp-client-authorizations/model.ts';
import type { HypermediaRetrievalServiceContract } from '#backend/services/hypermedia-retrieval/service.ts';
import {
  mcpHypermediaRetrievalResult,
  SearchHypermediaInputSchema,
} from '../hypermedia-retrieval/model.ts';
import { MCP_READ_TOOL_ANNOTATIONS } from '../tool-annotations.ts';
import { mcpToolSuccess } from '../tool-result.ts';
import { pagesAppHtml } from './app-html.gen.ts';
import { PAGES_APP_META, PAGES_APP_URI } from './app-meta.ts';
import { WIDGET_RESOURCE_TYPES, WidgetSearchSchema } from './search-model.ts';

const resourceMeta = { ui: { csp: { connectDomains: [], resourceDomains: [] } } };

export function registerPagesApp({
  server,
  principal,
  retrievalService,
}: {
  server: McpServer;
  principal: McpClientAuthorizationPrincipal;
  retrievalService: Pick<HypermediaRetrievalServiceContract, 'search'>;
}): void {
  server.registerTool(
    'open_resource_search',
    {
      title: 'Search Context Use',
      description:
        'Show up to ten ranked matches in an interactive picker. When the user asks for a page ambiguously, call this with their search words and resourceType knowledge_page so they can choose the page themselves. Omit resourceType to search pages, entities and assets together. Omit the query to open an empty search.',
      inputSchema: z.object({
        query: SearchHypermediaInputSchema.shape.query.optional(),
        resourceType: z.enum(WIDGET_RESOURCE_TYPES).optional(),
      }),
      outputSchema: WidgetSearchSchema,
      annotations: MCP_READ_TOOL_ANNOTATIONS,
      _meta: PAGES_APP_META,
    },
    async ({ query, resourceType }) => {
      const matches = query
        ? await retrievalService.search({
            ownerId: principal.ownerId,
            query,
            resourceTypes: resourceType ? [resourceType] : [...WIDGET_RESOURCE_TYPES],
            limit: 10,
          })
        : { results: [], truncated: false };
      return mcpToolSuccess({
        query: query ?? '',
        resourceType,
        results: matches.results.map(mcpHypermediaRetrievalResult),
        truncated: matches.truncated,
      });
    },
  );
  registerAppResource(
    server,
    'Context Use',
    PAGES_APP_URI,
    {
      description: 'Search pages, entities, and assets and open their previews.',
      _meta: resourceMeta,
    },
    () => ({
      contents: [
        {
          uri: PAGES_APP_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: pagesAppHtml,
          _meta: resourceMeta,
        },
      ],
    }),
  );
}
