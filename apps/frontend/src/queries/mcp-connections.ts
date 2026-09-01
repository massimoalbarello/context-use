import { queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';

export type McpConnectionList = NonNullable<
  Awaited<ReturnType<typeof api.api.mcp.connections.get>>['data']
>;
export type McpConnection = McpConnectionList['items'][number];
export type McpAuthorizationClient = NonNullable<
  Awaited<ReturnType<(typeof api.api.mcp)['authorization-client']['get']>>['data']
>;

export const mcpConnectionsQueryKey = ['mcp-connections'] as const;

export const mcpConnectionsQueryOptions = queryOptions({
  queryKey: mcpConnectionsQueryKey,
  queryFn: async () => {
    const { data, error } = await api.api.mcp.connections.get();
    if (error) {
      throw new Error(apiErrorMessage(error));
    }
    return data;
  },
});

export function mcpAuthorizationClientQueryOptions(clientId: string) {
  return queryOptions({
    queryKey: [...mcpConnectionsQueryKey, 'authorization-client', clientId],
    queryFn: async () => {
      const { data, error } = await api.api.mcp['authorization-client'].get({
        query: { clientId },
      });
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
  });
}

export async function approveMcpConnection(input: { clientId: string; name: string }) {
  const { data, error } = await api.api.mcp.connections.post(input);
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
  return data;
}

export async function renameMcpConnection(input: { connectionId: string; name: string }) {
  const { data, error } = await api.api.mcp
    .connections({
      connectionId: input.connectionId,
    })
    .patch({ name: input.name });
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
  return data;
}

export async function archiveMcpConnection(input: { connectionId: string }): Promise<void> {
  const { error } = await api.api.mcp
    .connections({
      connectionId: input.connectionId,
    })
    .delete();
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
}
