import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  archiveMcpConnection,
  mcpConnectionsQueryKey,
  renameMcpConnection,
} from '../../queries/mcp-connections';

export function useRenameMcpConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: renameMcpConnection,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: mcpConnectionsQueryKey }),
  });
}

export function useArchiveMcpConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: archiveMcpConnection,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: mcpConnectionsQueryKey }),
  });
}
