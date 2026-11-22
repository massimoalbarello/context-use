import { RESOURCE_MIME_TYPE, registerAppResource } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import { pagesAppHtml } from './app-html.gen.ts';
import { PAGES_APP_URI } from './app-meta.ts';

const resourceMeta = { ui: { csp: { connectDomains: [], resourceDomains: [] } } };

export function registerPagesApp(server: McpServer): void {
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
