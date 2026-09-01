import { t } from 'elysia';
import type {
  McpClientAuthorization,
  McpOAuthClient,
} from '#models/mcp-client-authorizations/model.ts';
import { MAX_MCP_CLIENT_NAME_LENGTH } from '#models/mcp-client-authorizations/model.ts';

export const McpClientSchema = t.Object({
  id: t.String(),
  name: t.String(),
  verifiedClientId: t.Nullable(t.String()),
  createdAt: t.String(),
  updatedAt: t.String(),
  archivedAt: t.Nullable(t.String()),
});

export const McpClientListSchema = t.Object({
  serverUrl: t.String(),
  items: t.Array(McpClientSchema),
});

export const McpAuthorizationClientSchema = t.Object({
  clientId: t.String(),
  verifiedClientId: t.Nullable(t.String()),
  suggestedName: t.Nullable(t.String()),
});

export const McpAuthorizationClientQuerySchema = t.Object({
  clientId: t.String({ minLength: 1 }),
});

export const ApproveMcpClientBodySchema = t.Object({
  clientId: t.String({ minLength: 1 }),
  name: t.String({ minLength: 1, maxLength: MAX_MCP_CLIENT_NAME_LENGTH }),
});

export const RenameMcpClientBodySchema = t.Object({
  name: t.String({ minLength: 1, maxLength: MAX_MCP_CLIENT_NAME_LENGTH }),
});

export const McpClientParamsSchema = t.Object({ clientAuthorizationId: t.String() });

export function mcpClientResponse(clientAuthorization: McpClientAuthorization) {
  return {
    id: clientAuthorization.id,
    name: clientAuthorization.name,
    verifiedClientId: clientAuthorization.verifiedClientId,
    createdAt: clientAuthorization.createdAt,
    updatedAt: clientAuthorization.updatedAt,
    archivedAt: clientAuthorization.archivedAt,
  };
}

export function mcpAuthorizationClientResponse(client: McpOAuthClient) {
  return client;
}
