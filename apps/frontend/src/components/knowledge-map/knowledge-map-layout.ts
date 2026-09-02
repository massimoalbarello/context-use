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
const RESOURCE_RADIAL_SPACING = 360;
const RESOURCE_DISCOVERY_WEIGHT = 0.66;
const RESOURCE_CLUSTER_OFFSET = 80;
const UNCONNECTED_PAGE_RADIAL_SPACING = 180;
const MAP_PADDING = 150;
const RESOURCE_MIN_DISTANCE = 116;
const RESOURCE_PAGE_LABEL_X_DISTANCE = 150;
const RESOURCE_PAGE_LABEL_Y_DISTANCE = 72;
const RESOURCE_SPIRAL_STEP = 64;
const RESOURCE_PLACEMENT_ATTEMPTS = 1600;
const PAGE_LABEL_MIN_DISTANCE = 180;
const PAGE_LABEL_SPIRAL_STEP = 64;
const PAGE_PLACEMENT_ATTEMPTS = 1600;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const VIEWPORT_RENDER_MARGIN_RATIO = 0.08;
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

function radialPoint(index: number, spacing: number): MapPoint {
  const angle = -Math.PI / 2 + index * GOLDEN_ANGLE;
  const radius = spacing * Math.sqrt(index + 1);
  return {
    x: MAP_CENTER.x + Math.cos(angle) * radius,
    y: MAP_CENTER.y + Math.sin(angle) * radius,
  };
}

function resourceCellCoordinate(value: number): number {
  return Math.floor(value / RESOURCE_MIN_DISTANCE);
}

function resourceCellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function nearbyResourcePoints(point: MapPoint, occupiedCells: Map<string, MapPoint[]>): MapPoint[] {
  const cellX = resourceCellCoordinate(point.x);
  const cellY = resourceCellCoordinate(point.y);
  const nearby: MapPoint[] = [];
  for (let x = cellX - 1; x <= cellX + 1; x += 1) {
    for (let y = cellY - 1; y <= cellY + 1; y += 1) {
      nearby.push(...(occupiedCells.get(resourceCellKey(x, y)) ?? []));
    }
  }
  return nearby;
}

function preferredResourcePoint({
  key,
  seed,
  packedPoints,
  resourceKeysByPage,
  discoveryIndexByPage,
}: {
  key: string;
  seed: ResourceSeed;
  packedPoints: Map<string, MapPoint>;
  resourceKeysByPage: Map<number, Set<string>>;
  discoveryIndexByPage: Map<number, number>;
}): MapPoint {
  if (seedIsSelf(seed)) {
    return MAP_CENTER;
  }
  const firstPageIndex = Math.max(0, seed.firstPageIndex);
  const connectedPoints = [...(resourceKeysByPage.get(firstPageIndex) ?? [])]
    .filter((connectedKey) => connectedKey !== key)
    .flatMap((connectedKey) => {
      const connectedPoint = packedPoints.get(connectedKey);
      return connectedPoint ? [connectedPoint] : [];
    });
  const discoveryIndex = discoveryIndexByPage.get(firstPageIndex) ?? 0;
  const discoveredAt = radialPoint(discoveryIndex + 1, RESOURCE_RADIAL_SPACING);
  const connectedCenter = connectedPoints.length > 0 ? pointAverage(connectedPoints) : MAP_CENTER;
  const discoveryWeight = connectedPoints.length > 0 ? RESOURCE_DISCOVERY_WEIGHT : 1;
  const semanticAnchor = {
    x: connectedCenter.x * (1 - discoveryWeight) + discoveredAt.x * discoveryWeight,
    y: connectedCenter.y * (1 - discoveryWeight) + discoveredAt.y * discoveryWeight,
  };
  const phase = (stableHash(key) / 0xffffffff) * Math.PI * 2;
  return {
    x: semanticAnchor.x + Math.cos(phase) * RESOURCE_CLUSTER_OFFSET,
    y: semanticAnchor.y + Math.sin(phase) * RESOURCE_CLUSTER_OFFSET,
  };
}

function availableResourcePoint({
  key,
  preferred,
  occupiedCells,
}: {
  key: string;
  preferred: MapPoint;
  occupiedCells: Map<string, MapPoint[]>;
}): MapPoint | undefined {
  const phase = (stableHash(key) / 0xffffffff) * Math.PI * 2;
  for (let attempt = 0; attempt < RESOURCE_PLACEMENT_ATTEMPTS; attempt += 1) {
    const radius = attempt === 0 ? 0 : RESOURCE_SPIRAL_STEP * Math.sqrt(attempt);
    const angle = phase + attempt * GOLDEN_ANGLE;
    const candidate = {
      x: preferred.x + Math.cos(angle) * radius,
      y: preferred.y + Math.sin(angle) * radius,
    };
    const available = nearbyResourcePoints(candidate, occupiedCells).every(
      (placed) => distanceBetween(candidate, placed) >= RESOURCE_MIN_DISTANCE,
    );
    if (available) {
      return candidate;
    }
  }
  return undefined;
}

function packResourcePoints({
  seeds,
  resourceKeysByPage,
}: {
  seeds: Map<string, ResourceSeed>;
  resourceKeysByPage: Map<number, Set<string>>;
}): Map<string, MapPoint> {
  const packedPoints = new Map<string, MapPoint>();
  const occupiedCells = new Map<string, MapPoint[]>();
  const orderedSeeds = [...seeds.entries()].sort(
    ([firstKey, first], [secondKey, second]) =>
      Number(seedIsSelf(second)) - Number(seedIsSelf(first)) ||
      first.firstPageIndex - second.firstPageIndex ||
      firstKey.localeCompare(secondKey),
  );
  const discoveryIndexByPage = new Map(
    [
      ...new Set(
        orderedSeeds.filter(([, seed]) => !seedIsSelf(seed)).map(([, seed]) => seed.firstPageIndex),
      ),
    ]
      .sort((first, second) => first - second)
      .map((pageIndex, index) => [pageIndex, index]),
  );

  for (const [key, seed] of orderedSeeds) {
    const preferred = preferredResourcePoint({
      key,
      seed,
      packedPoints,
      resourceKeysByPage,
      discoveryIndexByPage,
    });
    const point = availableResourcePoint({ key, preferred, occupiedCells });
    const placed = point ?? {
      x: preferred.x + RESOURCE_MIN_DISTANCE * (packedPoints.size + 1),
      y: preferred.y + RESOURCE_MIN_DISTANCE,
    };
    packedPoints.set(key, placed);
    const keyForPoint = resourceCellKey(
      resourceCellCoordinate(placed.x),
      resourceCellCoordinate(placed.y),
    );
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

function pointNearViewport(point: MapPoint, viewport: MapBounds): boolean {
  const marginX = viewport.width * VIEWPORT_RENDER_MARGIN_RATIO;
  const marginY = viewport.height * VIEWPORT_RENDER_MARGIN_RATIO;
  return (
    point.x >= viewport.x - marginX &&
    point.x <= viewport.x + viewport.width + marginX &&
    point.y >= viewport.y - marginY &&
    point.y <= viewport.y + viewport.height + marginY
  );
}

export function knowledgeMapLayoutInViewport(
  layout: KnowledgeMapLayout,
  viewport: MapBounds,
): KnowledgeMapLayout {
  const pages = layout.pages.filter(({ point }) => pointNearViewport(point, viewport));
  const visibleResourceKeys = new Set(pages.flatMap(({ resourceKeys }) => resourceKeys));
  const resources = layout.resources.filter(
    (resource) =>
      pointNearViewport(resource.point, viewport) &&
      (visibleResourceKeys.has(resource.key) ||
        (resource.kind === 'entity' && resource.entity.isSelf)),
  );
  return { ...layout, pages, resources };
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

function packPagePoints({
  pages,
  resourceKeysByPage,
  resourcePoints,
}: {
  pages: KnowledgeMapPage[];
  resourceKeysByPage: Map<number, Set<string>>;
  resourcePoints: Map<string, MapPoint>;
}): PagePoint[] {
  const placed: PagePoint[] = [];
  const allResourcePoints = [...resourcePoints.values()];
  const positionAvailable = (point: MapPoint) =>
    placed.every((other) => distanceBetween(point, other) >= PAGE_LABEL_MIN_DISTANCE) &&
    allResourcePoints.every(
      (resourcePoint) =>
        Math.abs(point.x - resourcePoint.x) >= RESOURCE_PAGE_LABEL_X_DISTANCE ||
        Math.abs(point.y - resourcePoint.y) >= RESOURCE_PAGE_LABEL_Y_DISTANCE,
    );

  for (const [index, page] of pages.entries()) {
    const connectedPoints = [...(resourceKeysByPage.get(index) ?? [])].flatMap((key) => {
      const point = resourcePoints.get(key);
      return point ? [point] : [];
    });
    const preferred =
      connectedPoints.length > 0
        ? pointAverage(connectedPoints)
        : radialPoint(index, UNCONNECTED_PAGE_RADIAL_SPACING);
    const phase = (stableHash(page.readableId) / 0xffffffff) * Math.PI * 2;
    let point: MapPoint | undefined;
    for (let attempt = 0; attempt < PAGE_PLACEMENT_ATTEMPTS; attempt += 1) {
      const radius = attempt === 0 ? 0 : PAGE_LABEL_SPIRAL_STEP * Math.sqrt(attempt);
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
    placed.push({
      ...(point ?? {
        x: preferred.x + PAGE_LABEL_MIN_DISTANCE * (placed.length + 1),
        y: preferred.y + PAGE_LABEL_MIN_DISTANCE,
      }),
      page,
    });
  }
  return placed;
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

  const { seeds, resourceKeysByPage } = resourceSeedsFrom({ pages, anchorEntity });
  const resourcePoints = packResourcePoints({
    seeds,
    resourceKeysByPage,
  });
  const pagePoints = packPagePoints({ pages, resourceKeysByPage, resourcePoints });

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
