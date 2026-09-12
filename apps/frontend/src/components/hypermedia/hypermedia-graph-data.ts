import type {
  HypermediaEntity,
  HypermediaNeighborhoodRequest,
  HypermediaNeighborhoods,
} from '../../queries/hypermedia';
import { hypermediaEntityKey } from '../../queries/hypermedia';

// Map pacing, below the server's batch ceiling. Existing batches never change on expansion.
export const HYPERMEDIA_EXPANSION_BATCH_SIZE = 4;

export function neighborhoodRequestKey(request: HypermediaNeighborhoodRequest): string {
  return `${hypermediaEntityKey(request.anchor)}:${request.cursor ?? 'first'}`;
}

export function appendNeighborhoodRequests({
  current,
  requests,
}: {
  current: HypermediaNeighborhoodRequest[][];
  requests: HypermediaNeighborhoodRequest[];
}): HypermediaNeighborhoodRequest[][] {
  const known = new Set(current.flat().map(neighborhoodRequestKey));
  const additions = requests.filter((request) => {
    const key = neighborhoodRequestKey(request);
    if (known.has(key)) {
      return false;
    }
    known.add(key);
    return true;
  });
  if (additions.length === 0) {
    return current;
  }
  const batches = [...current];
  for (let offset = 0; offset < additions.length; offset += HYPERMEDIA_EXPANSION_BATCH_SIZE) {
    batches.push(additions.slice(offset, offset + HYPERMEDIA_EXPANSION_BATCH_SIZE));
  }
  return batches;
}

export type HypermediaLayoutNeighborhood = {
  anchor: HypermediaEntity;
  neighbors: { entity: HypermediaEntity; sharedPageCount: number }[];
};

// These are views over Query-owned responses, not another server-data cache.
export function mergeHypermediaNeighborhoods(
  responses: HypermediaNeighborhoods[],
): HypermediaLayoutNeighborhood[] {
  const entities = new Map(
    responses.flatMap((response) =>
      response.entities.map((entity) => [hypermediaEntityKey(entity), entity] as const),
    ),
  );
  const anchorKeys = new Set(
    responses.flatMap((response) =>
      response.neighborhoods
        .filter(({ available }) => available)
        .map(({ anchor }) => hypermediaEntityKey(anchor)),
    ),
  );
  const relationships = new Map(
    responses.flatMap((response) =>
      response.relationships.map(
        (relationship) =>
          [
            [hypermediaEntityKey(relationship.source), hypermediaEntityKey(relationship.target)]
              .sort()
              .join('|'),
            relationship,
          ] as const,
      ),
    ),
  );
  const neighbors = new Map<string, HypermediaLayoutNeighborhood['neighbors']>();
  for (const relationship of relationships.values()) {
    const source = hypermediaEntityKey(relationship.source);
    const target = hypermediaEntityKey(relationship.target);
    for (const [from, to] of [
      [source, target],
      [target, source],
    ] as const) {
      const entity = entities.get(to);
      if (!entity) {
        continue;
      }
      const group = neighbors.get(from) ?? [];
      group.push({ entity, sharedPageCount: relationship.sharedPageCount });
      neighbors.set(from, group);
    }
  }
  return [...new Set([...anchorKeys, ...entities.keys()])].flatMap((key) => {
    const anchor = entities.get(key);
    return anchor
      ? [
          {
            anchor,
            neighbors: (neighbors.get(key) ?? []).sort(
              // biome-ignore lint/complexity/useMaxParams: Array.sort requires a comparator pair.
              (a, b) =>
                b.sharedPageCount - a.sharedPageCount ||
                a.entity.readableId.localeCompare(b.entity.readableId),
            ),
          },
        ]
      : [];
  });
}
