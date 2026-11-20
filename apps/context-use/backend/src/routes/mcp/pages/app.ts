import { RESOURCE_MIME_TYPE, registerAppResource } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import { pagesAppHtml } from './app-html.gen.ts';

export const PAGES_APP_URI = 'ui://context-use/pages.html';
export const PAGES_APP_META = { ui: { resourceUri: PAGES_APP_URI } };

export function registerPagesApp({ server }: { server: McpServer }): void {
  registerAppResource(
    server,
    'Context Use Pages',
    PAGES_APP_URI,
    {
      description: 'Browse, read, create, edit, and archive your Context Use pages.',
      _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } },
    },
    () => ({
      contents: [{ uri: PAGES_APP_URI, mimeType: RESOURCE_MIME_TYPE, text: pagesAppHtml }],
    }),
  );
}
