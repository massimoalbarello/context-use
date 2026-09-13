export type ArchiveResult<Blocker> =
  | { state: 'archived' }
  | { state: 'not_found' }
  | { state: 'resource_in_use'; blockers: Blocker[] };
