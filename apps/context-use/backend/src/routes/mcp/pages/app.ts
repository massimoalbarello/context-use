import { RESOURCE_MIME_TYPE, registerAppResource } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { PreviewAddressSchema } from '../coordinates.ts';
import { SearchHypermediaInputSchema } from '../hypermedia-retrieval/model.ts';
import { MCP_READ_TOOL_ANNOTATIONS } from '../tool-annotations.ts';
import { pagesAppHtml, pagesAppUri } from './app-html.gen.ts';
import { PAGES_APP_META } from './app-meta.ts';

const resourceMeta = { ui: { csp: { connectDomains: [], resourceDomains: [] } } };

export function registerPagesApp(server: McpServer): void {
  server.registerTool(
    'open_search_picker',
    {
      title: 'Open Context Use search',
      description:
        'Open an interactive picker when the user wants to browse or choose between ambiguous matches. For a page request, pass the topic and resourceTypes ["knowledge_page"]. The picker searches for up to ten matches. For research while composing a page, use search_hypermedia.',
      inputSchema: SearchHypermediaInputSchema.omit({ limit: true }),
      annotations: MCP_READ_TOOL_ANNOTATIONS,
      _meta: PAGES_APP_META,
    },
    (search) => ({
      content: [{ type: 'text', text: 'Opening Context Use search.' }],
      _meta: { search },
    }),
  );
  server.registerTool(
    'open_resource',
    {
      title: 'Open in Context Use',
      description:
        'Display a specific page, entity, or asset to the user in chat, for example when asked to show a photo or open a page for editing. Use a known canonical address. For discovery or to answer a question, use the read tools. When the user should choose a match, use open_search_picker.',
      inputSchema: z.object({ address: PreviewAddressSchema }),
      annotations: MCP_READ_TOOL_ANNOTATIONS,
      _meta: PAGES_APP_META,
    },
    ({ address }) => ({
      content: [{ type: 'text', text: `Opening ${address} in Context Use.` }],
      _meta: { address },
    }),
  );
  registerAppResource(
    server,
    'Context Use',
    pagesAppUri,
    {
      description: 'Search pages, entities, and assets and open their previews.',
      _meta: resourceMeta,
    },
    () => ({
      contents: [
        {
          uri: pagesAppUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: pagesAppHtml,
          _meta: resourceMeta,
        },
      ],
    }),
  );
}
