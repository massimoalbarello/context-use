import { type HypermediaPage, hypermediaEntityKey } from '../../queries/hypermedia';
import type { HypermediaLayoutEntity } from './hypermedia-layout';

export function filterHypermedia({
  entities,
  pages,
  matchingEntityKeys,
}: {
  entities: HypermediaLayoutEntity[];
  pages: HypermediaPage[];
  matchingEntityKeys?: ReadonlySet<string>;
}): { entities: HypermediaLayoutEntity[]; pages: HypermediaPage[] } {
  const knownEntityKeys = new Set(entities.map(({ key }) => key));
  const visibleEntities = entities.filter(
    (entity) => !matchingEntityKeys || matchingEntityKeys.has(entity.key),
  );
  const visibleEntityKeys = new Set(visibleEntities.map(({ key }) => key));
  return {
    entities: visibleEntities,
    pages: pages.map((page) => {
      const visibleReferences = page.entities.filter((reference) => {
        const key = hypermediaEntityKey(reference);
        return !matchingEntityKeys || !knownEntityKeys.has(key) || visibleEntityKeys.has(key);
      });
      return visibleReferences.length === page.entities.length
        ? page
        : { ...page, entities: visibleReferences };
    }),
  };
}
