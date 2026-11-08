import type { ResourceStatus } from '#backend/models/resource-archiving/model.ts';
import { publicationVisibilityFromSearch } from './publication-visibility';

export function resourceStatusFromSearch(value: unknown): ResourceStatus | undefined {
  return value === 'archived' ? 'archived' : undefined;
}

export function resourceStatusSearch(search: Record<string, unknown>) {
  return {
    status: resourceStatusFromSearch(search.status),
    visibility: publicationVisibilityFromSearch(search.visibility),
  };
}
