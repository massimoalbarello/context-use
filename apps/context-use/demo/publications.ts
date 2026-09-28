import type { PublicationsRepositoryContract } from '#backend/repositories/publications/repository.ts';
import type { PublicationApprovalServiceContract } from '#backend/services/publications/approval-service.ts';
import { readPublicationStatus } from '#backend/services/publications/status.ts';

export function createDemoPublications(
  publications: PublicationsRepositoryContract,
): PublicationApprovalServiceContract {
  const deny = () => Promise.reject(new Error('Public demo publication is read-only'));
  return {
    status: (input) => readPublicationStatus({ publications, ...input }),
    begin: deny,
    complete: deny,
  };
}
