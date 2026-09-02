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
  focusPoint: MapPoint;
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
const RESOURCE_MIN_DISTANCE = 116;
const RESOURCE_PAGE_LABEL_X_DISTANCE = 150;
const RESOURCE_PAGE_LABEL_Y_DISTANCE = 72;
const RESOURCE_SPIRAL_STEP = 27;
const RESOURCE_PLACEMENT_ATTEMPTS = 1600;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
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

function distanceBetween(first: MapPoint, second: MapPoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function seedIsSelf(seed: ResourceSeed): boolean {
  return seed.kind === 'entity' && seed.entity.isSelf;
}

function packResourcePoints({
  seeds,
  preferredPoints,
  pagePoints,
}: {
  seeds: Map<string, ResourceSeed>;
  preferredPoints: Map<string, MapPoint>;
  pagePoints: MapPoint[];
}): Map<string, MapPoint> {
  const packedPoints = new Map<string, MapPoint>();
  const occupiedCells = new Map<string, MapPoint[]>();
  const orderedSeeds = [...seeds.entries()].sort(
    ([firstKey, first], [secondKey, second]) =>
      Number(seedIsSelf(second)) - Number(seedIsSelf(first)) ||
      second.pageIndexes.size - first.pageIndexes.size ||
      firstKey.localeCompare(secondKey),
  );
  const cellCoordinate = (value: number) => Math.floor(value / RESOURCE_MIN_DISTANCE);
  const cellKey = (x: number, y: number) => `${x}:${y}`;
  const nearbyPoints = (point: MapPoint) => {
    const cellX = cellCoordinate(point.x);
    const cellY = cellCoordinate(point.y);
    const nearby: MapPoint[] = [];
    for (let x = cellX - 1; x <= cellX + 1; x += 1) {
      for (let y = cellY - 1; y <= cellY + 1; y += 1) {
        nearby.push(...(occupiedCells.get(cellKey(x, y)) ?? []));
      }
    }
    return nearby;
  };
  const positionAvailable = (point: MapPoint) =>
    nearbyPoints(point).every(
      (placed) => distanceBetween(point, placed) >= RESOURCE_MIN_DISTANCE,
    ) &&
    pagePoints.every(
      (pagePoint) =>
        Math.abs(point.x - pagePoint.x) >= RESOURCE_PAGE_LABEL_X_DISTANCE ||
        Math.abs(point.y - pagePoint.y) >= RESOURCE_PAGE_LABEL_Y_DISTANCE,
    );

  for (const [key] of orderedSeeds) {
    const preferred = preferredPoints.get(key)!;
    const phase = (stableHash(key) / 0xffffffff) * Math.PI * 2;
    let point: MapPoint | undefined;
    for (let attempt = 0; attempt < RESOURCE_PLACEMENT_ATTEMPTS; attempt += 1) {
      const radius = attempt === 0 ? 0 : RESOURCE_SPIRAL_STEP * Math.sqrt(attempt);
      const angle = phase + attempt * GOLDEN_ANGLE;
      const candidate = {
        x: preferred.x + Math.cos(angle) * radius,
        y: preferred.y + Math.sin(angle) * radius,
      };
      if (positionAvailable(candidate)) {
        point = candidate;
        break;
      }
    }
    const placed = point ?? {
      x: preferred.x + RESOURCE_MIN_DISTANCE * (packedPoints.size + 1),
      y: preferred.y + RESOURCE_MIN_DISTANCE,
    };
    packedPoints.set(key, placed);
    const keyForPoint = cellKey(cellCoordinate(placed.x), cellCoordinate(placed.y));
    const cell = occupiedCells.get(keyForPoint) ?? [];
    cell.push(placed);
    occupiedCells.set(keyForPoint, cell);
  }
  return packedPoints;
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

type PagePoint = MapPoint & { page: KnowledgeMapPage };

function resourceSeedsFrom({
  pages,
  anchorEntity,
}: {
  pages: KnowledgeMapPage[];
  anchorEntity?: KnowledgeMapEntity;
}): { seeds: Map<string, ResourceSeed>; resourceKeysByPage: Map<number, Set<string>> } {
  const seeds = new Map<string, ResourceSeed>();
  const resourceKeysByPage = new Map<number, Set<string>>();
  if (anchorEntity) {
    seeds.set(resourceKey('entity', anchorEntity.readableId), {
      kind: 'entity',
      entity: anchorEntity,
      pageIndexes: new Set(),
    });
  }
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
  return { seeds, resourceKeysByPage };
}

function preferredResourcePointsFrom({
  seeds,
  pagePoints,
}: {
  seeds: Map<string, ResourceSeed>;
  pagePoints: PagePoint[];
}): Map<string, MapPoint> {
  const preferredPoints = new Map<string, MapPoint>();
  const singlePageResources = new Map<number, string[]>();
  for (const [key, seed] of seeds) {
    const memberships = [...seed.pageIndexes];
    if (memberships.length > 1) {
      const average = pointAverage(memberships.map((index) => pagePoints[index]!));
      const angle = (stableHash(key) / 0xffffffff) * Math.PI * 2;
      preferredPoints.set(key, {
        x: average.x + Math.cos(angle) * 24,
        y: average.y + Math.sin(angle) * 24,
      });
    } else if (memberships.length === 0) {
      preferredPoints.set(
        key,
        pagePoints.length > 0 ? pointAverage(pagePoints) : { x: MAP_PADDING, y: MAP_PADDING },
      );
    } else {
      const pageIndex = memberships[0]!;
      const keys = singlePageResources.get(pageIndex) ?? [];
      keys.push(key);
      singlePageResources.set(pageIndex, keys);
    }
  }
  for (const [pageIndex, keys] of singlePageResources) {
    keys.sort();
    const center = pagePoints[pageIndex]!;
    const baseAngle = (stableHash(center.page.readableId) / 0xffffffff) * Math.PI * 2;
    for (const [index, key] of keys.entries()) {
      const angle = baseAngle + (index / Math.max(keys.length, 3)) * Math.PI * 2;
      const radius = 112 + (index % 2) * 28;
      preferredPoints.set(key, {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      });
    }
  }
  return preferredPoints;
}

export function buildKnowledgeMapLayout(
  pages: KnowledgeMapPage[],
  { anchorEntity }: { anchorEntity?: KnowledgeMapEntity } = {},
): KnowledgeMapLayout {
  if (pages.length === 0 && !anchorEntity) {
    return {
      pages: [],
      resources: [],
      references: [],
      focusPoint: { x: 450, y: 300 },
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
  const { seeds, resourceKeysByPage } = resourceSeedsFrom({ pages, anchorEntity });
  const preferredResourcePoints = preferredResourcePointsFrom({ seeds, pagePoints });

  const resourcePoints = packResourcePoints({
    seeds,
    preferredPoints: preferredResourcePoints,
    pagePoints,
  });

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
  const selfResource = resources.find(
    (resource) => resource.kind === 'entity' && resource.entity.isSelf,
  );
  const focusPoint =
    selfResource?.point ??
    (pageLayouts.length > 0
      ? pointAverage(pageLayouts.map(({ point }) => point))
      : resources[0]!.point);

  return {
    pages: pageLayouts,
    resources,
    references,
    focusPoint,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}
