export const MAX_MCP_CLIENT_NAME_LENGTH = 80;

export type McpClientAuthorization = {
  id: string;
  ownerId: string;
  name: string;
  oauthClientId: string;
  verifiedClientId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type McpOAuthClient = {
  clientId: string;
  verifiedClientId: string | null;
  suggestedName: string | null;
};

export type McpClientAuthorizationPrincipal = {
  ownerId: string;
  clientAuthorizationId: string;
};

export function normalizeMcpClientName(name: string): string | null {
  const normalized = name.trim();
  return normalized.length > 0 && normalized.length <= MAX_MCP_CLIENT_NAME_LENGTH
    ? normalized
    : null;
}
