import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useToastManager } from '../../components/ui/toast';
import { assetsQueryKey, unarchiveAsset } from '../../queries/assets';
import { entitiesQueryKey, unarchiveEntity } from '../../queries/entities';
import { historyQueryKey } from '../../queries/history';
import { knowledgeSuggestionsQueryKey } from '../../queries/knowledge-suggestions';
import { pagesQueryKey, unarchivePage } from '../../queries/pages';
import { publicationStatusQueryOptions } from '../../queries/publications';
import { recordDetailsQueryKey } from '../../queries/records';

const operations = { entity: unarchiveEntity, page: unarchivePage, asset: unarchiveAsset };
const destinations = {
  entity: '/app/entities/$id',
  page: '/app/pages/$id',
  asset: '/app/assets/$id',
} as const;

export function useUnarchiveResource({
  resourceType,
  onUnarchived,
}: {
  resourceType: keyof typeof operations;
  onUnarchived: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToastManager();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: operations[resourceType],
    onSuccess: (...[result, { readableId }]) => {
      if (result.state !== 'unarchived') {
        return;
      }
      // Restored relationships also change other resources' detail projections.
      for (const queryKey of [
        assetsQueryKey,
        entitiesQueryKey,
        pagesQueryKey,
        recordDetailsQueryKey,
        historyQueryKey,
        knowledgeSuggestionsQueryKey,
      ]) {
        void queryClient.invalidateQueries({ queryKey });
      }
      void queryClient.invalidateQueries(
        publicationStatusQueryOptions({ resourceType, readableId }),
      );
      onUnarchived();
      toast.add({
        title: `${resourceType === 'entity' ? 'Entity' : resourceType === 'page' ? 'Page' : 'Asset'} unarchived`,
        actionProps: {
          children: `View ${resourceType}`,
          onClick: () => {
            void navigate({
              to: destinations[resourceType],
              params: { id: readableId },
              search: {},
            });
          },
        },
      });
    },
  });
}
