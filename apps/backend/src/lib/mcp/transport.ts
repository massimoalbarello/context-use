import { type AuthInfo, createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import type { McpClientAuthorizationPrincipal } from '#models/mcp-client-authorizations/model.ts';

export interface McpTransportContract {
  fetch(input: {
    request: Request;
    accessToken: string;
    oauthClientId: string;
    scopes: string[];
    expiresAt: number;
    resource: URL;
    principal: McpClientAuthorizationPrincipal;
  }): Promise<Response>;
  close(): Promise<void>;
}

export function createMcpTransport(): McpTransportContract {
  const handler = createMcpHandler(
    () =>
      new McpServer({
        name: 'context-use',
        version: '1.0.0',
      }),
    { legacy: 'reject' },
  );

  return {
    async fetch(input) {
      const authInfo: AuthInfo = {
        token: input.accessToken,
        clientId: input.oauthClientId,
        scopes: input.scopes,
        expiresAt: input.expiresAt,
        resource: input.resource,
        extra: {
          ownerId: input.principal.ownerId,
          clientAuthorizationId: input.principal.clientAuthorizationId,
        },
      };
      return await handler.fetch(input.request, { authInfo });
    },
    close: () => handler.close(),
  };
}
