const MAX_RESOURCE_READABLE_ID_LENGTH = 120;

export const RESOURCE_COLLECTION_PATHS = {
  entity: '/entities',
  page: '/pages',
  asset: '/assets',
  record: '/records',
} as const;

const RESOURCE_KINDS = Object.keys(
  RESOURCE_COLLECTION_PATHS,
) as (keyof typeof RESOURCE_COLLECTION_PATHS)[];

export type ResourceSelection = {
  kind: (typeof RESOURCE_KINDS)[number];
  readableId: string;
  fragment?: string;
};

export type ResourceSearch = {
  resource?: ResourceSelection['kind'];
  resourceId?: string;
  expanded?: boolean;
  view?: 'preview' | 'links' | 'revisions' | 'metadata';
};

export function resourceSearch(search: Record<string, unknown>): ResourceSearch {
  const resource = RESOURCE_KINDS.find((kind) => kind === search.resource);
  if (!resource || typeof search.resourceId !== 'string' || !search.resourceId.trim()) {
    return {};
  }
  return {
    resource,
    resourceId: search.resourceId.trim().slice(0, MAX_RESOURCE_READABLE_ID_LENGTH),
    ...(search.expanded === true ? { expanded: true } : {}),
    ...(['preview', 'links', 'revisions', 'metadata'].includes(String(search.view))
      ? { view: search.view as ResourceSearch['view'] }
      : {}),
  };
}

export function selectedResource(search: ResourceSearch): ResourceSelection | undefined {
  return search.resource && search.resourceId
    ? { kind: search.resource, readableId: search.resourceId }
    : undefined;
}
