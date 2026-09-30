import { useMutation, useQueryClient } from '@tanstack/react-query';
import { mcpClientsQueryKey, revokeMcpClient } from '../../queries/mcp-clients';

export function useRevokeMcpClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revokeMcpClient,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: mcpClientsQueryKey }),
  });
}
