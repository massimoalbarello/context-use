export const RESOURCE_STATUSES = ['active', 'archived'] as const;
export type ResourceStatus = (typeof RESOURCE_STATUSES)[number];

export interface ResourceArchiveState {
  archivedAt: string | null;
}

export type UnarchiveBlocker = {
  resourceType: 'entity' | 'page' | 'asset';
  readableId: string;
  name: string;
};

export type UnarchiveResult =
  | { state: 'unarchived' }
  | { state: 'not_found' }
  | { state: 'dependencies_archived'; blockers: UnarchiveBlocker[] };

export type ArchiveResult<Blocker> =
  | { state: 'archived' }
  | { state: 'not_found' }
  | { state: 'resource_published' }
  | { state: 'resource_in_use'; blockers: Blocker[] };
