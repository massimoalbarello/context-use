// biome-ignore-all lint/complexity/useMaxParams: Geometry callbacks use coordinate pairs and indexed collection values.
// biome-ignore-all lint/style/noMagicNumbers: The deterministic SVG layout is defined by visual geometry constants.
import type {
  KnowledgeMapAsset,
  KnowledgeMapEntity,
  KnowledgeMapPage,
} from '../../queries/knowledge-map';

export type MapPoint = { x: number; y: number };

export type KnowledgeMapResource =
  | { key: string; kind: 'entity'; entity: KnowledgeMapEntity; point: MapPoint }
  | { key: string; kind: 'asset'; asset: KnowledgeMapAsset; point: MapPoint };

export type KnowledgeMapPageLayout = {
  page: KnowledgeMapPage;
  point: MapPoint;
  cloudPath: string;
  colorIndex: number;
  resourceKeys: string[];
  words: string[];
};

export type KnowledgeMapReferenceLayout = {
  key: string;
  source: MapPoint;
  target: MapPoint;
};

export type KnowledgeMapLayout = {
  pages: KnowledgeMapPageLayout[];
  resources: KnowledgeMapResource[];
  references: KnowledgeMapReferenceLayout[];
  bounds: { x: number; y: number; width: number; height: number };
};

type ResourceSeed =
  | { kind: 'entity'; entity: KnowledgeMapEntity; pageIndexes: Set<number> }
  | { kind: 'asset'; asset: KnowledgeMapAsset; pageIndexes: Set<number> };
type ResourceSeedInput =
  | { kind: 'entity'; entity: KnowledgeMapEntity }
  | { kind: 'asset'; asset: KnowledgeMapAsset };

const PAGE_X_SPACING = 340;
const PAGE_Y_SPACING = 270;
const MAP_PADDING = 150;
const WORD_STOP_LIST = new Set([
  'about',
  'after',
  'again',
  'also',
  'and',
  'are',
  'been',
  'before',
  'being',
  'but',
  'can',
  'for',
  'from',
  'has',
  'have',
  'into',
  'its',
  'not',
  'that',
  'the',
  'their',
  'then',
  'this',
  'through',
  'was',
  'were',
  'with',
]);

function resourceKey(kind: 'entity' | 'asset', readableId: string): string {
  return `${kind}:${readableId}`;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pointAverage(points: MapPoint[]): MapPoint {
  const sum = points.reduce(
    (current, point) => ({ x: current.x + point.x, y: current.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function cross(origin: MapPoint, a: MapPoint, b: MapPoint): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

function convexHull(points: MapPoint[]): MapPoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 2) {
    return sorted;
  }
  const lower: MapPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: MapPoint[] = [];
  for (const point of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function cloudPath(points: MapPoint[]): string {
  const outlinePoints = points.flatMap((point, pointIndex) => {
    const radius = pointIndex === 0 ? 78 : 49;
    return Array.from({ length: 8 }, (_, index) => {
      const angle = (index / 8) * Math.PI * 2;
      return { x: point.x + Math.cos(angle) * radius, y: point.y + Math.sin(angle) * radius };
    });
  });
  const hull = convexHull(outlinePoints);
  if (hull.length === 0) {
    return '';
  }
  const midpoint = (a: MapPoint, b: MapPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const start = midpoint(hull.at(-1)!, hull[0]!);
  const commands = hull.map((point, index) => {
    const next = hull[(index + 1) % hull.length]!;
    const end = midpoint(point, next);
    return `Q ${point.x.toFixed(1)} ${point.y.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
  });
  return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} ${commands.join(' ')} Z`;
}

export function pageCloudWords(page: Pick<KnowledgeMapPage, 'title' | 'excerpt'>): string[] {
  const titleWords = new Set(page.title.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const counts = new Map<string, { count: number; first: string }>();
  for (const word of page.excerpt.match(/[\p{L}\p{N}]+/gu) ?? []) {
    const normalized = word.toLocaleLowerCase();
    if (normalized.length < 4 || WORD_STOP_LIST.has(normalized) || titleWords.has(normalized)) {
      continue;
    }
    const current = counts.get(normalized);
    counts.set(normalized, { count: (current?.count ?? 0) + 1, first: current?.first ?? word });
  }
  return [...counts.values()]
    .sort(
      (a, b) =>
        b.count - a.count || b.first.length - a.first.length || a.first.localeCompare(b.first),
    )
    .slice(0, 3)
    .map(({ first }) => first);
}

export function filterKnowledgeMapPages({
  pages,
  query,
}: {
  pages: KnowledgeMapPage[];
  query: string | undefined;
}): KnowledgeMapPage[] {
  const normalized = query?.trim().toLocaleLowerCase();
  if (!normalized) {
    return pages;
  }
  return pages.filter((page) =>
    [
      page.title,
      page.excerpt,
      ...page.mentions.flatMap((entity) => [entity.name, entity.description]),
      ...page.assetUsages.map(({ asset }) => asset.name),
    ].some((value) => value.toLocaleLowerCase().includes(normalized)),
  );
}

export function buildKnowledgeMapLayout(pages: KnowledgeMapPage[]): KnowledgeMapLayout {
  if (pages.length === 0) {
    return {
      pages: [],
      resources: [],
      references: [],
      bounds: { x: 0, y: 0, width: 900, height: 600 },
    };
  }

  const columns = Math.max(1, Math.ceil(Math.sqrt(pages.length * 1.35)));
  const pagePoints = pages.map((page, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    return {
      x: MAP_PADDING + column * PAGE_X_SPACING + (row % 2) * 45,
      y: MAP_PADDING + row * PAGE_Y_SPACING,
      page,
    };
  });
  const pageIndexByReadableId = new Map(
    pagePoints.map(({ page }, index) => [page.readableId, index]),
  );
  const seeds = new Map<string, ResourceSeed>();
  const resourceKeysByPage = new Map<number, Set<string>>();
  const addSeed = (key: string, seed: ResourceSeedInput, pageIndex: number) => {
    const existing = seeds.get(key);
    if (existing) {
      existing.pageIndexes.add(pageIndex);
    } else {
      seeds.set(key, { ...seed, pageIndexes: new Set([pageIndex]) } as ResourceSeed);
    }
    const pageKeys = resourceKeysByPage.get(pageIndex) ?? new Set<string>();
    pageKeys.add(key);
    resourceKeysByPage.set(pageIndex, pageKeys);
  };

  for (const [pageIndex, page] of pages.entries()) {
    for (const entity of page.mentions) {
      addSeed(resourceKey('entity', entity.readableId), { kind: 'entity', entity }, pageIndex);
    }
    for (const { asset } of page.assetUsages) {
      addSeed(resourceKey('asset', asset.readableId), { kind: 'asset', asset }, pageIndex);
    }
  }

  const resourcePoints = new Map<string, MapPoint>();
  const singlePageResources = new Map<number, string[]>();
  for (const [key, seed] of seeds) {
    const memberships = [...seed.pageIndexes];
    if (memberships.length > 1) {
      const average = pointAverage(memberships.map((index) => pagePoints[index]!));
      const angle = (stableHash(key) / 0xffffffff) * Math.PI * 2;
      resourcePoints.set(key, {
        x: average.x + Math.cos(angle) * 24,
        y: average.y + Math.sin(angle) * 24,
      });
      continue;
    }
    const pageIndex = memberships[0]!;
    const keys = singlePageResources.get(pageIndex) ?? [];
    keys.push(key);
    singlePageResources.set(pageIndex, keys);
  }
  for (const [pageIndex, keys] of singlePageResources) {
    keys.sort();
    const center = pagePoints[pageIndex]!;
    const baseAngle = (stableHash(center.page.readableId) / 0xffffffff) * Math.PI * 2;
    for (const [index, key] of keys.entries()) {
      const angle = baseAngle + (index / Math.max(keys.length, 3)) * Math.PI * 2;
      const radius = 112 + (index % 2) * 28;
      resourcePoints.set(key, {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      });
    }
  }

  const resources = [...seeds.entries()].map(([key, seed]): KnowledgeMapResource => {
    const point = resourcePoints.get(key)!;
    return seed.kind === 'entity'
      ? { key, kind: 'entity', entity: seed.entity, point }
      : { key, kind: 'asset', asset: seed.asset, point };
  });
  const pageLayouts = pagePoints.map(({ page, x, y }, index): KnowledgeMapPageLayout => {
    const keys = [...(resourceKeysByPage.get(index) ?? [])];
    return {
      page,
      point: { x, y },
      cloudPath: cloudPath([{ x, y }, ...keys.map((key) => resourcePoints.get(key)!)]),
      colorIndex: (stableHash(page.readableId) % 5) + 1,
      resourceKeys: keys,
      words: pageCloudWords(page),
    };
  });
  const references = pageLayouts.flatMap(({ page, point }) =>
    page.references.flatMap(({ page: target, fragment }) => {
      const targetIndex = pageIndexByReadableId.get(target.readableId);
      if (targetIndex === undefined) {
        return [];
      }
      return [
        {
          key: `${page.readableId}:${target.readableId}:${fragment ?? ''}`,
          source: point,
          target: pagePoints[targetIndex]!,
        },
      ];
    }),
  );
  const allPoints = [
    ...pageLayouts.map(({ point }) => point),
    ...resources.map(({ point }) => point),
  ];
  const minX = Math.min(...allPoints.map(({ x }) => x)) - MAP_PADDING;
  const maxX = Math.max(...allPoints.map(({ x }) => x)) + MAP_PADDING;
  const minY = Math.min(...allPoints.map(({ y }) => y)) - MAP_PADDING;
  const maxY = Math.max(...allPoints.map(({ y }) => y)) + MAP_PADDING;

  return {
    pages: pageLayouts,
    resources,
    references,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}
