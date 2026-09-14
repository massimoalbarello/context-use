import type { MapEntity, MapNeighborhoodRequest, MapNeighborhoods } from '../../queries/map';
import { mapEntityKey } from '../../queries/map';

// Map pacing, below the server's batch ceiling. Existing batches never change on expansion.
export const MAP_EXPANSION_BATCH_SIZE = 4;

export function neighborhoodRequestKey(request: MapNeighborhoodRequest): string {
  return `${mapEntityKey(request.anchor)}:${request.cursor ?? 'first'}`;
}

export function appendNeighborhoodRequests({
  current,
  requests,
}: {
  current: MapNeighborhoodRequest[][];
  requests: MapNeighborhoodRequest[];
}): MapNeighborhoodRequest[][] {
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
  for (let offset = 0; offset < additions.length; offset += MAP_EXPANSION_BATCH_SIZE) {
    batches.push(additions.slice(offset, offset + MAP_EXPANSION_BATCH_SIZE));
  }
  return batches;
}

export type MapLayoutNeighborhood = {
  anchor: MapEntity;
  neighbors: { entity: MapEntity; sharedPageCount: number }[];
};

// These are views over Query-owned responses, not another server-data cache.
export function mergeMapNeighborhoods(responses: MapNeighborhoods[]): MapLayoutNeighborhood[] {
  const entities = new Map(
    responses.flatMap((response) =>
      response.entities.map((entity) => [mapEntityKey(entity), entity] as const),
    ),
  );
  const anchorKeys = new Set(
    responses.flatMap((response) =>
      response.neighborhoods
        .filter(({ available }) => available)
        .map(({ anchor }) => mapEntityKey(anchor)),
    ),
  );
  const relationships = new Map(
    responses.flatMap((response) =>
      response.relationships.map(
        (relationship) =>
          [
            [mapEntityKey(relationship.source), mapEntityKey(relationship.target)].sort().join('|'),
            relationship,
          ] as const,
      ),
    ),
  );
  const neighbors = new Map<string, MapLayoutNeighborhood['neighbors']>();
  for (const relationship of relationships.values()) {
    const source = mapEntityKey(relationship.source);
    const target = mapEntityKey(relationship.target);
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
