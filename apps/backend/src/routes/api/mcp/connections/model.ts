import { t } from 'elysia';
import type { McpConnection, McpOAuthClient } from '#models/mcp-connections/model.ts';
import { MAX_MCP_CONNECTION_NAME_LENGTH } from '#models/mcp-connections/model.ts';

export const McpConnectionSchema = t.Object({
  id: t.String(),
  name: t.String(),
  verifiedClientId: t.Nullable(t.String()),
  createdAt: t.String(),
  updatedAt: t.String(),
  archivedAt: t.Nullable(t.String()),
});

export const McpConnectionListSchema = t.Object({
  serverUrl: t.String(),
  items: t.Array(McpConnectionSchema),
});

export const McpAuthorizationClientSchema = t.Object({
  clientId: t.String(),
  verifiedClientId: t.Nullable(t.String()),
  suggestedName: t.Nullable(t.String()),
});

export const McpAuthorizationClientQuerySchema = t.Object({
  clientId: t.String({ minLength: 1 }),
});

export const ApproveMcpConnectionBodySchema = t.Object({
  clientId: t.String({ minLength: 1 }),
  name: t.String({ minLength: 1, maxLength: MAX_MCP_CONNECTION_NAME_LENGTH }),
});

export const RenameMcpConnectionBodySchema = t.Object({
  name: t.String({ minLength: 1, maxLength: MAX_MCP_CONNECTION_NAME_LENGTH }),
});

export const McpConnectionParamsSchema = t.Object({ connectionId: t.String() });

export function mcpConnectionResponse(connection: McpConnection) {
  return {
    id: connection.id,
    name: connection.name,
    verifiedClientId: connection.verifiedClientId,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    archivedAt: connection.archivedAt,
  };
}

export function mcpAuthorizationClientResponse(client: McpOAuthClient) {
  return client;
}
