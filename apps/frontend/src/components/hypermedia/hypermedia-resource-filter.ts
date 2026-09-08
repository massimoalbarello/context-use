import {
  type HypermediaPage,
  type HypermediaResourceKind,
  hypermediaResourceKey,
} from '../../queries/hypermedia';
import type { HypermediaLayoutResource } from './hypermedia-layout';

export type { HypermediaResourceKind } from '../../queries/hypermedia';
export type HypermediaResourceDisplay = 'assets' | 'all';

const ALL_HYPERMEDIA_RESOURCE_KINDS: HypermediaResourceKind[] = ['entity', 'asset'];

export function displayedHypermediaResourceKinds(value: unknown): HypermediaResourceKind[] {
  if (value === 'assets') {
    return ['asset'];
  }
  return value === 'all' ? [...ALL_HYPERMEDIA_RESOURCE_KINDS] : ['entity'];
}

export function displayedHypermediaResourceKindsValue(
  kinds: HypermediaResourceKind[],
): HypermediaResourceDisplay | undefined {
  const selectedKinds = new Set(kinds);
  if (selectedKinds.has('entity') && selectedKinds.has('asset')) {
    return 'all';
  }
  return selectedKinds.has('asset') ? 'assets' : undefined;
}

export function toggleDisplayedHypermediaResourceKind({
  kinds,
  kind,
}: {
  kinds: HypermediaResourceKind[];
  kind: HypermediaResourceKind;
}): HypermediaResourceKind[] {
  const selectedKinds = new Set(kinds);
  if (selectedKinds.has(kind)) {
    if (selectedKinds.size === 1) {
      return kinds;
    }
    selectedKinds.delete(kind);
  } else {
    selectedKinds.add(kind);
  }
  return ALL_HYPERMEDIA_RESOURCE_KINDS.filter((candidate) => selectedKinds.has(candidate));
}

function hypermediaResourceMatchesQuery({
  resource,
  normalizedQuery,
}: {
  resource: HypermediaLayoutResource;
  normalizedQuery: string;
}): boolean {
  const values =
    resource.kind === 'entity'
      ? [resource.entity.readableId, resource.entity.name, resource.entity.description]
      : [resource.asset.readableId, resource.asset.name];
  return values.some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
}

export function filterHypermedia({
  resources,
  pages,
  kinds,
  query,
}: {
  resources: HypermediaLayoutResource[];
  pages: HypermediaPage[];
  kinds: HypermediaResourceKind[];
  query?: string;
}): { resources: HypermediaLayoutResource[]; pages: HypermediaPage[] } {
  const visibleKinds = new Set(kinds);
  const normalizedQuery = query?.trim().toLocaleLowerCase() ?? '';
  const knownResourceKeys = new Set(resources.map(({ key }) => key));
  const visibleResources = resources.filter(
    (resource) =>
      visibleKinds.has(resource.kind) &&
      (!normalizedQuery || hypermediaResourceMatchesQuery({ resource, normalizedQuery })),
  );
  const visibleResourceKeys = new Set(visibleResources.map(({ key }) => key));
  return {
    resources: visibleResources,
    pages: pages.map((page) => {
      const visibleReferences = page.resources.filter((reference) => {
        if (!visibleKinds.has(reference.kind)) {
          return false;
        }
        const key = hypermediaResourceKey(reference);
        return !normalizedQuery || !knownResourceKeys.has(key) || visibleResourceKeys.has(key);
      });
      return visibleReferences.length === page.resources.length
        ? page
        : { ...page, resources: visibleReferences };
    }),
  };
}
