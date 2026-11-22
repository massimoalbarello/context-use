import { RESOURCE_MIME_TYPE, registerAppResource } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { PreviewAddressSchema } from '../coordinates.ts';
import { MCP_READ_TOOL_ANNOTATIONS } from '../tool-annotations.ts';
import { mcpAppHtml, mcpAppUri } from './html.gen.ts';

export const MCP_APP_META = { ui: { resourceUri: mcpAppUri } };

export function registerMcpApp({
  server,
  instanceOrigin,
}: {
  server: McpServer;
  instanceOrigin: string;
}): void {
  const resourceMeta = {
    ui: { csp: { connectDomains: [instanceOrigin], resourceDomains: [instanceOrigin] } },
  };
  server.registerTool(
    'open_resource',
    {
      title: 'Open in Context Use',
      description:
        'Display a specific page, entity, or asset to the user in chat, for example when asked to show a photo or open a page for editing. Use a known canonical address. For discovery or to answer a question, use the read tools. If several items match, offer their titles in chat before opening one.',
      inputSchema: z.object({ address: PreviewAddressSchema }),
      annotations: MCP_READ_TOOL_ANNOTATIONS,
      _meta: MCP_APP_META,
    },
    ({ address }) => ({
      content: [{ type: 'text', text: `Opening ${address} in Context Use.` }],
      _meta: { address },
    }),
  );
  registerAppResource(
    server,
    'Context Use',
    mcpAppUri,
    {
      description: 'View pages, entities, and assets, and edit a selected page.',
      _meta: resourceMeta,
    },
    () => ({
      contents: [
        {
          uri: mcpAppUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: mcpAppHtml,
          _meta: resourceMeta,
        },
      ],
    }),
  );
}
