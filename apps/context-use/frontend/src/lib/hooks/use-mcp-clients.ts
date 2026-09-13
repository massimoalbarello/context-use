import { useMutation, useQueryClient } from '@tanstack/react-query';
import { archiveMcpClient, mcpClientsQueryKey, renameMcpClient } from '../../queries/mcp-clients';

export function useRenameMcpClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: renameMcpClient,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: mcpClientsQueryKey }),
  });
}

export function useArchiveMcpClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: archiveMcpClient,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: mcpClientsQueryKey }),
  });
}
