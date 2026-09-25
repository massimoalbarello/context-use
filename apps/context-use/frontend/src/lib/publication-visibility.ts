import { PUBLICATION_VISIBILITIES } from '#backend/models/publications/model.ts';

export function publicationVisibilityFromSearch(value: unknown) {
  const visibility = PUBLICATION_VISIBILITIES.find((option) => option === value);
  return visibility === 'all' ? undefined : visibility;
}
