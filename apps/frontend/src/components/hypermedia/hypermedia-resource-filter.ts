import { type HypermediaPage, hypermediaResourceKey } from '../../queries/hypermedia';
import type { HypermediaLayoutResource } from './hypermedia-layout';

export function filterHypermedia({
  resources,
  pages,
  matchingResourceKeys,
}: {
  resources: HypermediaLayoutResource[];
  pages: HypermediaPage[];
  matchingResourceKeys?: ReadonlySet<string>;
}): { resources: HypermediaLayoutResource[]; pages: HypermediaPage[] } {
  const knownResourceKeys = new Set(resources.map(({ key }) => key));
  const visibleResources = resources.filter(
    (resource) => !matchingResourceKeys || matchingResourceKeys.has(resource.key),
  );
  const visibleResourceKeys = new Set(visibleResources.map(({ key }) => key));
  return {
    resources: visibleResources,
    pages: pages.map((page) => {
      const visibleReferences = page.resources.filter((reference) => {
        const key = hypermediaResourceKey(reference);
        return !matchingResourceKeys || !knownResourceKeys.has(key) || visibleResourceKeys.has(key);
      });
      return visibleReferences.length === page.resources.length
        ? page
        : { ...page, resources: visibleReferences };
    }),
  };
}
