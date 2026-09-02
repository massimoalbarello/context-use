// biome-ignore-all lint/complexity/useMaxParams: Geometry callbacks use coordinate pairs and indexed collection values.
// biome-ignore-all lint/style/noMagicNumbers: The deterministic SVG layout is defined by visual geometry constants.

import { isEmbeddableAsset } from '../../lib/asset-presentation';
import type {
  KnowledgeMapAsset,
  KnowledgeMapEntity,
  KnowledgeMapPage,
} from '../../queries/knowledge-map';

export type MapPoint = { x: number; y: number };
export type MapBounds = MapPoint & { width: number; height: number };

export type KnowledgeMapResource =
  | { key: string; kind: 'entity'; entity: KnowledgeMapEntity; point: MapPoint }
  | { key: string; kind: 'asset'; asset: KnowledgeMapAsset; point: MapPoint };

export type KnowledgeMapPageLayout = {
  page: KnowledgeMapPage;
  point: MapPoint;
  cloudPath: string;
  colorIndex: number;
  resourceKeys: string[];
};

export type KnowledgeMapLayout = {
  pages: KnowledgeMapPageLayout[];
  resources: KnowledgeMapResource[];
  focusPoint: MapPoint;
  bounds: MapBounds;
};

type ResourceSeed =
  | {
      kind: 'entity';
      entity: KnowledgeMapEntity;
      pageIndexes: Set<number>;
      firstPageIndex: number;
    }
  | {
      kind: 'asset';
      asset: KnowledgeMapAsset;
      pageIndexes: Set<number>;
      firstPageIndex: number;
    };
type ResourceSeedInput =
  | { kind: 'entity'; entity: KnowledgeMapEntity }
  | { kind: 'asset'; asset: KnowledgeMapAsset };

const MAP_CENTER: MapPoint = { x: 0, y: 0 };
const PAGE_RADIAL_SPACING = 260;
const MAP_PADDING = 150;
const RESOURCE_MIN_DISTANCE = 116;
const RESOURCE_PAGE_LABEL_X_DISTANCE = 150;
const RESOURCE_PAGE_LABEL_Y_DISTANCE = 72;
const RESOURCE_SPIRAL_STEP = 64;
const RESOURCE_PLACEMENT_ATTEMPTS = 1600;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
export const MAX_EAGER_KNOWLEDGE_MAP_IMAGES = 12;

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
  pagePoints: PagePoint[];
}): Map<string, MapPoint> {
  const packedPoints = new Map<string, MapPoint>();
  const occupiedCells = new Map<string, MapPoint[]>();
  const pageLabelCells = new Map<string, Array<MapPoint & { pageIndex: number }>>();
  const orderedSeeds = [...seeds.entries()].sort(
    ([firstKey, first], [secondKey, second]) =>
      Number(seedIsSelf(second)) - Number(seedIsSelf(first)) ||
      first.firstPageIndex - second.firstPageIndex ||
      firstKey.localeCompare(secondKey),
  );
  const cellCoordinate = (value: number) => Math.floor(value / RESOURCE_MIN_DISTANCE);
  const cellKey = (x: number, y: number) => `${x}:${y}`;
  const pageLabelCellCoordinate = (point: MapPoint) => ({
    x: Math.floor(point.x / RESOURCE_PAGE_LABEL_X_DISTANCE),
    y: Math.floor(point.y / RESOURCE_PAGE_LABEL_Y_DISTANCE),
  });
  for (const [pageIndex, pagePoint] of pagePoints.entries()) {
    const cell = pageLabelCellCoordinate(pagePoint);
    const key = cellKey(cell.x, cell.y);
    pageLabelCells.set(key, [...(pageLabelCells.get(key) ?? []), { ...pagePoint, pageIndex }]);
  }
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
  const nearbyPageLabels = (point: MapPoint, firstPageIndex: number) => {
    const cell = pageLabelCellCoordinate(point);
    const nearby: MapPoint[] = [];
    for (let x = cell.x - 1; x <= cell.x + 1; x += 1) {
      for (let y = cell.y - 1; y <= cell.y + 1; y += 1) {
        nearby.push(
          ...(pageLabelCells.get(cellKey(x, y)) ?? []).filter(
            ({ pageIndex }) => pageIndex <= firstPageIndex,
          ),
        );
      }
    }
    return nearby;
  };
  const positionAvailable = (point: MapPoint, firstPageIndex: number) =>
    nearbyPoints(point).every(
      (placed) => distanceBetween(point, placed) >= RESOURCE_MIN_DISTANCE,
    ) &&
    nearbyPageLabels(point, firstPageIndex).every(
      (pagePoint) =>
        Math.abs(point.x - pagePoint.x) >= RESOURCE_PAGE_LABEL_X_DISTANCE ||
        Math.abs(point.y - pagePoint.y) >= RESOURCE_PAGE_LABEL_Y_DISTANCE,
    );

  for (const [key, seed] of orderedSeeds) {
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
      if (positionAvailable(candidate, seed.firstPageIndex)) {
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

export function mapViewportNearBoundary(viewport: MapBounds, bounds: MapBounds): boolean {
  const marginX = Math.min(viewport.width * 0.18, bounds.width * 0.22);
  const marginY = Math.min(viewport.height * 0.18, bounds.height * 0.22);
  return (
    viewport.x <= bounds.x + marginX ||
    viewport.y <= bounds.y + marginY ||
    viewport.x + viewport.width >= bounds.x + bounds.width - marginX ||
    viewport.y + viewport.height >= bounds.y + bounds.height - marginY
  );
}

export function eagerKnowledgeMapImageKeys(layout: KnowledgeMapLayout): Set<string> {
  return new Set(
    layout.resources
      .filter((resource) =>
        resource.kind === 'entity'
          ? Boolean(resource.entity.image)
          : isEmbeddableAsset(resource.asset),
      )
      .sort(
        (first, second) =>
          distanceBetween(first.point, layout.focusPoint) -
            distanceBetween(second.point, layout.focusPoint) || first.key.localeCompare(second.key),
      )
      .slice(0, MAX_EAGER_KNOWLEDGE_MAP_IMAGES)
      .map(({ key }) => key),
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
      firstPageIndex: -1,
    });
  }
  const addSeed = (key: string, seed: ResourceSeedInput, pageIndex: number) => {
    const existing = seeds.get(key);
    if (existing) {
      existing.pageIndexes.add(pageIndex);
    } else {
      seeds.set(key, {
        ...seed,
        pageIndexes: new Set([pageIndex]),
        firstPageIndex: pageIndex,
      } as ResourceSeed);
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
  for (const [key, seed] of seeds) {
    if (seedIsSelf(seed)) {
      preferredPoints.set(key, MAP_CENTER);
      continue;
    }
    const center = pagePoints[seed.firstPageIndex] ?? MAP_CENTER;
    const angle = (stableHash(key) / 0xffffffff) * Math.PI * 2;
    const radius = 112 + (stableHash(`${key}:radius`) % 3) * 14;
    preferredPoints.set(key, {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    });
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
      focusPoint: { x: 450, y: 300 },
      bounds: { x: 0, y: 0, width: 900, height: 600 },
    };
  }

  const pagePoints = pages.map((page, index) => {
    const angle = -Math.PI / 2 + index * GOLDEN_ANGLE;
    const radius = PAGE_RADIAL_SPACING * Math.sqrt(index + 1);
    return {
      x: MAP_CENTER.x + Math.cos(angle) * radius,
      y: MAP_CENTER.y + Math.sin(angle) * radius,
      page,
    };
  });
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
    };
  });
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
    focusPoint,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}
