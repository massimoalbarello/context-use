// biome-ignore-all lint/style/noMagicNumbers: The deterministic Hypermedia geometry is defined by visual constants.
// biome-ignore-all lint/complexity/useMaxParams: Geometry helpers read more clearly with point pairs and collection indexes.

import type {
  HypermediaPage,
  HypermediaResource,
  HypermediaResourceNeighborhood,
} from '../../queries/hypermedia';
import { hypermediaResourceKey, hypermediaResourceReference } from '../../queries/hypermedia';

export type CanvasPoint = { x: number; y: number };
export type CanvasBounds = CanvasPoint & { width: number; height: number };

export type HypermediaLayoutResource =
  | {
      key: string;
      kind: 'entity';
      entity: Extract<HypermediaResource, { kind: 'entity' }>['entity'];
      point: CanvasPoint;
    }
  | {
      key: string;
      kind: 'asset';
      asset: Extract<HypermediaResource, { kind: 'asset' }>['asset'];
      point: CanvasPoint;
    };

export type HypermediaPageLayout = {
  page: HypermediaPage;
  point: CanvasPoint;
  cloudPath: string;
  colorIndex: number;
  resourceKeys: string[];
};

export type HypermediaLayout = {
  resources: HypermediaLayoutResource[];
  pages: HypermediaPageLayout[];
  initialFocus: CanvasPoint;
  bounds: CanvasBounds;
};

const CANVAS_PADDING = 160;
const INITIAL_VIEW_WIDTH = 900;
const INITIAL_VIEW_HEIGHT = 620;
const RESOURCE_MIN_DISTANCE = 150;
const RESOURCE_SPIRAL_STEP = 56;
const PAGE_SPIRAL_STEP = 76;
const RESOURCE_RESERVED_WIDTH = 200;
const RESOURCE_RESERVED_HEIGHT = 144;
const PAGE_LABEL_CHARACTER_WIDTH = 9;
const PAGE_LABEL_HORIZONTAL_PADDING = 56;
const PAGE_LABEL_RESERVED_HEIGHT = 72;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
export const HYPERMEDIA_PAGE_LABEL_MAX_CHARACTERS = 28;

type CanvasArea = {
  point: CanvasPoint;
  halfWidth: number;
  halfHeight: number;
};

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function average(points: CanvasPoint[]): CanvasPoint {
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), {
    x: 0,
    y: 0,
  });
  return { x: total.x / points.length, y: total.y / points.length };
}

function distance(first: CanvasPoint, second: CanvasPoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function openPoint({
  key,
  preferred,
  step,
  isAvailable,
}: {
  key: string;
  preferred: CanvasPoint;
  step: number;
  isAvailable: (candidate: CanvasPoint) => boolean;
}): CanvasPoint {
  const phase = (stableHash(key) / 0xffffffff) * Math.PI * 2;
  for (let index = 0; index < 1200; index += 1) {
    const radius = index === 0 ? 0 : step * Math.sqrt(index);
    const candidate = {
      x: preferred.x + Math.cos(phase + index * GOLDEN_ANGLE) * radius,
      y: preferred.y + Math.sin(phase + index * GOLDEN_ANGLE) * radius,
    };
    if (isAvailable(candidate)) {
      return candidate;
    }
  }
  return preferred;
}

function areasOverlap(first: CanvasArea, second: CanvasArea): boolean {
  return (
    Math.abs(first.point.x - second.point.x) < first.halfWidth + second.halfWidth &&
    Math.abs(first.point.y - second.point.y) < first.halfHeight + second.halfHeight
  );
}

function resourceArea(resource: HypermediaLayoutResource): CanvasArea {
  return {
    point: resource.point,
    halfWidth: RESOURCE_RESERVED_WIDTH / 2,
    halfHeight: RESOURCE_RESERVED_HEIGHT / 2,
  };
}

function pageLabelArea(title: string, point: CanvasPoint): CanvasArea {
  const visibleCharacters = Math.min(title.length, HYPERMEDIA_PAGE_LABEL_MAX_CHARACTERS);
  return {
    point,
    halfWidth: (visibleCharacters * PAGE_LABEL_CHARACTER_WIDTH + PAGE_LABEL_HORIZONTAL_PADDING) / 2,
    halfHeight: PAGE_LABEL_RESERVED_HEIGHT / 2,
  };
}

function resourceAt(resource: HypermediaResource, point: CanvasPoint): HypermediaLayoutResource {
  const key = hypermediaResourceKey(hypermediaResourceReference(resource));
  return resource.kind === 'entity'
    ? { key, kind: 'entity', entity: resource.entity, point }
    : { key, kind: 'asset', asset: resource.asset, point };
}

export function buildStableResources(
  neighborhoods: HypermediaResourceNeighborhood[],
): HypermediaLayoutResource[] {
  const resources = new Map<string, HypermediaLayoutResource>();
  const placed: CanvasPoint[] = [];
  const neighborCountByAnchor = new Map<string, number>();

  function addAnchor(resource: HypermediaResource): HypermediaLayoutResource {
    const key = hypermediaResourceKey(hypermediaResourceReference(resource));
    const existing = resources.get(key);
    if (existing) {
      return existing;
    }
    const index = resources.size;
    const preferred =
      index === 0
        ? { x: 0, y: 0 }
        : {
            x: Math.cos(index * GOLDEN_ANGLE) * 340 * Math.sqrt(index),
            y: Math.sin(index * GOLDEN_ANGLE) * 340 * Math.sqrt(index),
          };
    const point = openPoint({
      key,
      preferred,
      step: RESOURCE_SPIRAL_STEP,
      isAvailable: (candidate) =>
        placed.every((placedPoint) => distance(candidate, placedPoint) >= RESOURCE_MIN_DISTANCE),
    });
    const positionedResource = resourceAt(resource, point);
    resources.set(key, positionedResource);
    placed.push(point);
    return positionedResource;
  }

  for (const neighborhood of neighborhoods) {
    const anchor = addAnchor(neighborhood.anchor);
    const anchorOffset = neighborCountByAnchor.get(anchor.key) ?? 0;
    for (const [index, neighbor] of neighborhood.neighbors.entries()) {
      const key = hypermediaResourceKey(hypermediaResourceReference(neighbor.resource));
      if (resources.has(key)) {
        continue;
      }
      const placementIndex = anchorOffset + index;
      const radius =
        280 + Math.sqrt(placementIndex) * 76 - Math.min(6, neighbor.sharedPageCount) * 12;
      const angle = (stableHash(`${anchor.key}:${key}`) / 0xffffffff) * Math.PI * 2;
      const preferred = {
        x: anchor.point.x + Math.cos(angle) * radius,
        y: anchor.point.y + Math.sin(angle) * radius,
      };
      const point = openPoint({
        key,
        preferred,
        step: RESOURCE_SPIRAL_STEP,
        isAvailable: (candidate) =>
          placed.every((placedPoint) => distance(candidate, placedPoint) >= RESOURCE_MIN_DISTANCE),
      });
      resources.set(key, resourceAt(neighbor.resource, point));
      placed.push(point);
    }
    neighborCountByAnchor.set(anchor.key, anchorOffset + neighborhood.neighbors.length);
  }

  return [...resources.values()];
}

function cross(origin: CanvasPoint, first: CanvasPoint, second: CanvasPoint): number {
  return (
    (first.x - origin.x) * (second.y - origin.y) - (first.y - origin.y) * (second.x - origin.x)
  );
}

function convexHull(points: CanvasPoint[]): CanvasPoint[] {
  const sorted = [...points].sort((first, second) => first.x - second.x || first.y - second.y);
  if (sorted.length <= 2) {
    return sorted;
  }
  const lower: CanvasPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: CanvasPoint[] = [];
  for (const point of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function cloudPath(points: CanvasPoint[]): string {
  const outline = points.flatMap((point, pointIndex) =>
    Array.from({ length: 8 }, (_, index) => {
      const angle = (index / 8) * Math.PI * 2;
      const radius = pointIndex === 0 ? 74 : 46;
      return { x: point.x + Math.cos(angle) * radius, y: point.y + Math.sin(angle) * radius };
    }),
  );
  const hull = convexHull(outline);
  if (hull.length === 0) {
    return '';
  }
  const midpoint = (first: CanvasPoint, second: CanvasPoint) => ({
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  });
  const start = midpoint(hull.at(-1)!, hull[0]!);
  const curves = hull.map((point, index) => {
    const end = midpoint(point, hull[(index + 1) % hull.length]!);
    return `Q ${point.x.toFixed(1)} ${point.y.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
  });
  return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} ${curves.join(' ')} Z`;
}

function pageLayouts(
  resources: HypermediaLayoutResource[],
  pages: HypermediaPage[],
): HypermediaPageLayout[] {
  const pointsByKey = new Map(resources.map((resource) => [resource.key, resource.point]));
  const occupiedAreas = resources.map(resourceArea);
  return pages.map((page, index) => {
    const resourceKeys = page.resources.map(hypermediaResourceKey);
    const connectedPoints = resourceKeys.flatMap((key) => {
      const point = pointsByKey.get(key);
      return point ? [point] : [];
    });
    const preferred =
      connectedPoints.length > 0
        ? average(connectedPoints)
        : {
            x: Math.cos(index * GOLDEN_ANGLE) * 220 * Math.sqrt(index + 1),
            y: Math.sin(index * GOLDEN_ANGLE) * 220 * Math.sqrt(index + 1),
          };
    const point = openPoint({
      key: `page:${page.readableId}`,
      preferred,
      step: PAGE_SPIRAL_STEP,
      isAvailable: (candidate) => {
        const candidateArea = pageLabelArea(page.title, candidate);
        return occupiedAreas.every((area) => !areasOverlap(candidateArea, area));
      },
    });
    occupiedAreas.push(pageLabelArea(page.title, point));
    return {
      page,
      point,
      cloudPath: cloudPath([point, ...connectedPoints]),
      colorIndex: (stableHash(page.readableId) % 5) + 1,
      resourceKeys,
    };
  });
}

export function buildHypermediaLayout(
  resources: HypermediaLayoutResource[],
  pages: HypermediaPage[],
): HypermediaLayout {
  const laidOutPages = pageLayouts(resources, pages);
  const allPoints = [
    ...resources.map(({ point }) => point),
    ...laidOutPages.map(({ point }) => point),
  ];
  if (allPoints.length === 0) {
    return {
      resources,
      pages: laidOutPages,
      initialFocus: { x: 0, y: 0 },
      bounds: { x: -450, y: -310, width: INITIAL_VIEW_WIDTH, height: INITIAL_VIEW_HEIGHT },
    };
  }
  const minX = Math.min(...allPoints.map(({ x }) => x)) - CANVAS_PADDING;
  const maxX = Math.max(...allPoints.map(({ x }) => x)) + CANVAS_PADDING;
  const minY = Math.min(...allPoints.map(({ y }) => y)) - CANVAS_PADDING;
  const maxY = Math.max(...allPoints.map(({ y }) => y)) + CANVAS_PADDING;
  return {
    resources,
    pages: laidOutPages,
    initialFocus: resources[0]?.point ?? laidOutPages[0]!.point,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}

export function initialHypermediaViewBox(layout: HypermediaLayout): CanvasBounds {
  return {
    x: layout.initialFocus.x - INITIAL_VIEW_WIDTH / 2,
    y: layout.initialFocus.y - INITIAL_VIEW_HEIGHT / 2,
    width: INITIAL_VIEW_WIDTH,
    height: INITIAL_VIEW_HEIGHT,
  };
}
