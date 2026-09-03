import { useMutation, useQueryClient } from '@tanstack/react-query';
import { assetsQueryKey } from '../../queries/assets';
import {
  entitiesQueryKey,
  type RemoveEntityImageVariables,
  removeEntityImage,
  type SetEntityImageVariables,
  setEntityImage,
} from '../../queries/entities';
import { hypermediaQueryKey } from '../../queries/hypermedia';
import { pagesQueryKey } from '../../queries/pages';
import { profileQueryKey } from '../../queries/profile';

function useEntityImageMutation<TVariables>({
  mutationFn,
}: {
  mutationFn: (variables: TVariables) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: entitiesQueryKey }),
        queryClient.invalidateQueries({ queryKey: pagesQueryKey }),
        queryClient.invalidateQueries({ queryKey: assetsQueryKey }),
        queryClient.invalidateQueries({ queryKey: hypermediaQueryKey }),
        queryClient.invalidateQueries({ queryKey: profileQueryKey }),
      ]);
    },
  });
}

export function useSetEntityImage() {
  return useEntityImageMutation<SetEntityImageVariables>({ mutationFn: setEntityImage });
}

export function useRemoveEntityImage() {
  return useEntityImageMutation<RemoveEntityImageVariables>({ mutationFn: removeEntityImage });
}
