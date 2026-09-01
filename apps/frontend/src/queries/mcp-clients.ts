import { queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';

export type McpClientList = NonNullable<
  Awaited<ReturnType<typeof api.api.mcp.clients.get>>['data']
>;
export type McpClient = McpClientList['items'][number];
export type McpAuthorizationClient = NonNullable<
  Awaited<ReturnType<(typeof api.api.mcp)['authorization-client']['get']>>['data']
>;

export const mcpClientsQueryKey = ['mcp-clients'] as const;

export const mcpClientsQueryOptions = queryOptions({
  queryKey: mcpClientsQueryKey,
  queryFn: async () => {
    const { data, error } = await api.api.mcp.clients.get();
    if (error) {
      throw new Error(apiErrorMessage(error));
    }
    return data;
  },
});

export function mcpAuthorizationClientQueryOptions(clientId: string) {
  return queryOptions({
    queryKey: [...mcpClientsQueryKey, 'authorization-client', clientId],
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

export async function approveMcpClient(input: { clientId: string; name: string }) {
  const { data, error } = await api.api.mcp.clients.post(input);
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
  return data;
}

export async function renameMcpClient(input: { clientAuthorizationId: string; name: string }) {
  const { data, error } = await api.api.mcp
    .clients({
      clientAuthorizationId: input.clientAuthorizationId,
    })
    .patch({ name: input.name });
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
  return data;
}

export async function archiveMcpClient(input: { clientAuthorizationId: string }): Promise<void> {
  const { error } = await api.api.mcp
    .clients({
      clientAuthorizationId: input.clientAuthorizationId,
    })
    .archive.put();
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
}
