import { queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ApiStatus, apiErrorMessage } from '../lib/api-error';

export type PublicationRequest = Parameters<typeof api.api.publications.approvals.post>[0];
export type PublicationReady = NonNullable<
  Awaited<ReturnType<typeof api.api.publications.approvals.post>>['data']
>;
export type PublicationBlocker = PublicationReady['preparation']['blockers'][number];
export type PublicationTarget = Pick<PublicationRequest, 'resourceType' | 'readableId'>;
type CompleteApproval = ReturnType<typeof api.api.publications.approvals>['complete']['post'];
export type CompletePublicationVariables = {
  approvalId: string;
  assertion: Parameters<CompleteApproval>[0]['assertion'];
};

export class PublicationError extends Error {
  readonly blockers: PublicationBlocker[];

  constructor({ message, blockers = [] }: { message: string; blockers?: PublicationBlocker[] }) {
    super(message);
    this.name = 'PublicationError';
    this.blockers = blockers;
  }
}

export const publicationsQueryKey = ['publications'] as const;

export function publicationStatusQueryOptions(target: PublicationTarget) {
  return queryOptions({
    queryKey: [...publicationsQueryKey, target.resourceType, target.readableId],
    queryFn: async () => {
      const { data, error } = await api.api
        .publications({ resourceType: target.resourceType })({ readableId: target.readableId })
        .get();
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
  });
}

export async function beginPublication(request: PublicationRequest): Promise<PublicationReady> {
  const { data, error } = await api.api.publications.approvals.post(request);
  if (error) {
    throw new PublicationError({
      message: apiErrorMessage(error),
      blockers:
        error.status === ApiStatus.Conflict && 'blockers' in error.value
          ? error.value.blockers
          : [],
    });
  }
  return data;
}

export async function completePublication({ approvalId, assertion }: CompletePublicationVariables) {
  const { data, error } = await api.api.publications.approvals({ approvalId }).complete.post({
    assertion,
  });
  if (error) {
    throw new PublicationError({
      message: apiErrorMessage(error),
      blockers:
        error.status === ApiStatus.Conflict && 'blockers' in error.value
          ? error.value.blockers
          : [],
    });
  }
  return data;
}
