import { RESOURCE_MIME_TYPE, registerAppResource } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import { SearchHypermediaInputSchema } from '../hypermedia-retrieval/model.ts';
import { MCP_READ_TOOL_ANNOTATIONS } from '../tool-annotations.ts';
import { pagesAppHtml } from './app-html.gen.ts';
import { PAGES_APP_META, PAGES_APP_URI } from './app-meta.ts';

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
