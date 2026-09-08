import type { HypermediaPage, HypermediaResourceReference } from '../../queries/hypermedia';
import type { HypermediaLayoutResource } from './hypermedia-layout';

export type HypermediaResourceKind = HypermediaResourceReference['kind'];
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

export function filterHypermediaByResourceKinds({
  resources,
  pages,
  kinds,
}: {
  resources: HypermediaLayoutResource[];
  pages: HypermediaPage[];
  kinds: HypermediaResourceKind[];
}): { resources: HypermediaLayoutResource[]; pages: HypermediaPage[] } {
  const visibleKinds = new Set(kinds);
  return {
    resources: resources.filter(({ kind }) => visibleKinds.has(kind)),
    pages: pages.map((page) => {
      const visibleResources = page.resources.filter(({ kind }) => visibleKinds.has(kind));
      return visibleResources.length === page.resources.length
        ? page
        : { ...page, resources: visibleResources };
    }),
  };
}
