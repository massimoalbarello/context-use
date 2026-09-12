import {
  type HypermediaAnchorRequest,
  type HypermediaNeighborhoods,
  type HypermediaRelationship,
  MAX_HYPERMEDIA_EXTRA_RELATIONSHIPS,
} from '#models/hypermedia-graph/model.ts';
import type { Queries } from '#queries.gen.ts';
import { entityFrom } from '#views/entities/entity-view.ts';

type GraphRow = Queries['ListHypermediaNeighborhoods'];

export function neighborhoodsFromRows({
  rows,
  anchors,
  limit,
}: {
  rows: GraphRow[];
  anchors: HypermediaAnchorRequest[];
  limit: number;
}): HypermediaNeighborhoods {
  const returnedRows = rows.filter(
    (row) =>
      row.rowType === 'anchor' ||
      row.position <= (row.rowType === 'neighbor' ? limit : MAX_HYPERMEDIA_EXTRA_RELATIONSHIPS),
  );
  const entities = new Map(
    returnedRows.map(
      ({
        rowType: _type,
        sourceReadableId: _source,
        sharedPageCount: _count,
        position: _position,
        ...row
      }) => [row.readableId, entityFrom(row)],
    ),
  );
  const relationships = new Map<string, HypermediaRelationship>();
  for (const row of returnedRows.filter(({ rowType }) => rowType !== 'anchor')) {
    const [source, target] = [row.sourceReadableId, row.readableId].sort();
    relationships.set(`${source}:${target}`, {
      source: { readableId: source! },
      target: { readableId: target! },
      sharedPageCount: Number(row.sharedPageCount),
    });
  }
  return {
    entities: [...entities.values()],
    relationships: [...relationships.values()],
    relationshipsTruncated: rows.some(
      (row) => row.rowType === 'relationship' && row.position > MAX_HYPERMEDIA_EXTRA_RELATIONSHIPS,
    ),
    neighborhoods: anchors.map(({ anchor }) => {
      const neighbors = rows.filter(
        (row) => row.rowType === 'neighbor' && row.sourceReadableId === anchor.readableId,
      );
      const selected = neighbors.slice(0, limit);
      const last = selected.at(-1);
      return {
        anchor,
        available: entities.has(anchor.readableId),
        neighbors: selected.map((row) => ({
          entity: { readableId: row.readableId },
          sharedPageCount: Number(row.sharedPageCount),
        })),
        nextPage:
          neighbors.length > limit && last
            ? { readableId: last.readableId, sharedPageCount: Number(last.sharedPageCount) }
            : null,
      };
    }),
  };
}
