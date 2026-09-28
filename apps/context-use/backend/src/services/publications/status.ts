import type { PublicationResource } from '#backend/models/publications/model.ts';
import type { PublicationsRepositoryContract } from '#backend/repositories/publications/repository.ts';

export async function readPublicationStatus({
  publications,
  ...input
}: {
  publications: PublicationsRepositoryContract;
  ownerId: string;
  readableId: string;
  resourceType: PublicationResource['resourceType'];
}) {
  if (input.resourceType === 'page') {
    const publication = await publications.pageStatus(input);
    return publication ? { resourceType: 'page' as const, ...publication } : null;
  }
  const publication =
    input.resourceType === 'entity'
      ? await publications.entityStatus(input)
      : input.resourceType === 'record'
        ? await publications.recordStatus(input)
        : await publications.assetStatus(input);
  return publication ? { resourceType: input.resourceType, ...publication } : null;
}
