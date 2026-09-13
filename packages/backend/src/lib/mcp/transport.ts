import { type AuthInfo, createMcpHandler, type McpServer } from '@modelcontextprotocol/server';
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

export type ContextUseMcpServerFactory = (input: {
  principal: McpClientAuthorizationPrincipal;
}) => McpServer;

function principalFrom(authInfo: AuthInfo | undefined): McpClientAuthorizationPrincipal {
  const principal = authInfo?.extra?.principal;
  if (
    !principal ||
    typeof principal !== 'object' ||
    !('ownerId' in principal) ||
    typeof principal.ownerId !== 'string' ||
    !('clientAuthorizationId' in principal) ||
    typeof principal.clientAuthorizationId !== 'string' ||
    !('clientAuthorizationName' in principal) ||
    typeof principal.clientAuthorizationName !== 'string'
  ) {
    throw new Error('Authenticated MCP principal is missing from the transport request');
  }
  return {
    ownerId: principal.ownerId,
    clientAuthorizationId: principal.clientAuthorizationId,
    clientAuthorizationName: principal.clientAuthorizationName,
  };
}

export function createMcpTransport({
  createServer,
}: {
  createServer: ContextUseMcpServerFactory;
}): McpTransportContract {
  const handler = createMcpHandler(
    ({ authInfo }) => createServer({ principal: principalFrom(authInfo) }),
    // The SDK serves 2025-era requests statelessly from this same authenticated factory, so
    // compatibility cannot drift into a second set of tools or bypass the application services.
    { legacy: 'stateless' },
  );

  return {
    async fetch(input) {
      const authInfo: AuthInfo = {
        token: input.accessToken,
        clientId: input.oauthClientId,
        scopes: input.scopes,
        expiresAt: input.expiresAt,
        resource: input.resource,
        extra: { principal: input.principal },
      };
      return await handler.fetch(input.request, { authInfo });
    },
    close: () => handler.close(),
  };
}
