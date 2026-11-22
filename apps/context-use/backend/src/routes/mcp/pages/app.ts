import { RESOURCE_MIME_TYPE, registerAppResource } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import { MCP_READ_TOOL_ANNOTATIONS } from '../tool-annotations.ts';
import { pagesAppHtml } from './app-html.gen.ts';

export const PAGES_APP_URI = 'ui://context-use/page-search.html';
export const PAGES_APP_META = { ui: { resourceUri: PAGES_APP_URI } };

export function registerPagesApp({ server }: { server: McpServer }): void {
  server.registerTool(
    'open_page_search',
    {
      title: 'Open page search',
      description:
        'Open the interactive page search when the user wants to find and edit their pages in chat.',
      annotations: MCP_READ_TOOL_ANNOTATIONS,
      _meta: PAGES_APP_META,
    },
    async () => ({ content: [] }),
  );
  registerAppResource(
    server,
    'Context Use Pages',
    PAGES_APP_URI,
    {
      description: 'Search and edit your Context Use pages.',
      _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } },
    },
    () => ({
      contents: [{ uri: PAGES_APP_URI, mimeType: RESOURCE_MIME_TYPE, text: pagesAppHtml }],
    }),
  );
}
