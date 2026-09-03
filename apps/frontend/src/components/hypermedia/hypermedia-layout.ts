// biome-ignore-all lint/style/noMagicNumbers: The deterministic map geometry is defined by visual constants.
// biome-ignore-all lint/complexity/useMaxParams: Geometry helpers read more clearly with point pairs and collection indexes.

import type {
  HypermediaPage,
  HypermediaResource,
  HypermediaResourceNeighborhood,
} from '../../queries/hypermedia';
import { hypermediaResourceKey, hypermediaResourceReference } from '../../queries/hypermedia';

export type MapPoint = { x: number; y: number };
export type MapBounds = MapPoint & { width: number; height: number };

export type HypermediaLandmark =
  | {
      key: string;
      kind: 'entity';
      entity: Extract<HypermediaResource, { kind: 'entity' }>['entity'];
      point: MapPoint;
    }
  | {
      key: string;
      kind: 'asset';
      asset: Extract<HypermediaResource, { kind: 'asset' }>['asset'];
      point: MapPoint;
    };

export type HypermediaPageLayout = {
  page: HypermediaPage;
  point: MapPoint;
  cloudPath: string;
  colorIndex: number;
  resourceKeys: string[];
};

export type HypermediaLayout = {
  landmarks: HypermediaLandmark[];
  pages: HypermediaPageLayout[];
  initialFocus: MapPoint;
  bounds: MapBounds;
};

const MAP_PADDING = 160;
const INITIAL_VIEW_WIDTH = 900;
const INITIAL_VIEW_HEIGHT = 620;
const LANDMARK_MIN_DISTANCE = 150;
const LANDMARK_SPIRAL_STEP = 56;
const PAGE_MIN_DISTANCE = 240;
const PAGE_SPIRAL_STEP = 54;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function average(points: MapPoint[]): MapPoint {
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), {
    x: 0,
    y: 0,
  });
  return { x: total.x / points.length, y: total.y / points.length };
}

function distance(first: MapPoint, second: MapPoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function openPoint({
  key,
  preferred,
  occupied,
  minimumDistance,
  step,
}: {
  key: string;
  preferred: MapPoint;
  occupied: MapPoint[];
  minimumDistance: number;
  step: number;
}): MapPoint {
  const phase = (stableHash(key) / 0xffffffff) * Math.PI * 2;
  for (let index = 0; index < 1200; index += 1) {
    const radius = index === 0 ? 0 : step * Math.sqrt(index);
    const candidate = {
      x: preferred.x + Math.cos(phase + index * GOLDEN_ANGLE) * radius,
      y: preferred.y + Math.sin(phase + index * GOLDEN_ANGLE) * radius,
    };
    if (occupied.every((point) => distance(candidate, point) >= minimumDistance)) {
      return candidate;
    }
  }
  return { x: preferred.x + occupied.length * minimumDistance, y: preferred.y };
}

function landmarkFrom(resource: HypermediaResource, point: MapPoint): HypermediaLandmark {
  const key = hypermediaResourceKey(hypermediaResourceReference(resource));
  return resource.kind === 'entity'
    ? { key, kind: 'entity', entity: resource.entity, point }
    : { key, kind: 'asset', asset: resource.asset, point };
}

export function buildStableLandmarks(
  neighborhoods: HypermediaResourceNeighborhood[],
): HypermediaLandmark[] {
  const landmarks = new Map<string, HypermediaLandmark>();
  const placed: MapPoint[] = [];
  const neighborCountByAnchor = new Map<string, number>();

  function addAnchor(resource: HypermediaResource): HypermediaLandmark {
    const key = hypermediaResourceKey(hypermediaResourceReference(resource));
    const existing = landmarks.get(key);
    if (existing) {
      return existing;
    }
    const index = landmarks.size;
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
      occupied: placed,
      minimumDistance: LANDMARK_MIN_DISTANCE,
      step: LANDMARK_SPIRAL_STEP,
    });
    const landmark = landmarkFrom(resource, point);
    landmarks.set(key, landmark);
    placed.push(point);
    return landmark;
  }

  for (const neighborhood of neighborhoods) {
    const anchor = addAnchor(neighborhood.anchor);
    const anchorOffset = neighborCountByAnchor.get(anchor.key) ?? 0;
    for (const [index, neighbor] of neighborhood.neighbors.entries()) {
      const key = hypermediaResourceKey(hypermediaResourceReference(neighbor.resource));
      if (landmarks.has(key)) {
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
        occupied: placed,
        minimumDistance: LANDMARK_MIN_DISTANCE,
        step: LANDMARK_SPIRAL_STEP,
      });
      landmarks.set(key, landmarkFrom(neighbor.resource, point));
      placed.push(point);
    }
    neighborCountByAnchor.set(anchor.key, anchorOffset + neighborhood.neighbors.length);
  }

  return [...landmarks.values()];
}

function cross(origin: MapPoint, first: MapPoint, second: MapPoint): number {
  return (
    (first.x - origin.x) * (second.y - origin.y) - (first.y - origin.y) * (second.x - origin.x)
  );
}

function convexHull(points: MapPoint[]): MapPoint[] {
  const sorted = [...points].sort((first, second) => first.x - second.x || first.y - second.y);
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
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function cloudPath(points: MapPoint[]): string {
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
  const midpoint = (first: MapPoint, second: MapPoint) => ({
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
  landmarks: HypermediaLandmark[],
  pages: HypermediaPage[],
): HypermediaPageLayout[] {
  const pointsByKey = new Map(landmarks.map((landmark) => [landmark.key, landmark.point]));
  const occupied: MapPoint[] = [];
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
      occupied: [...occupied, ...connectedPoints],
      minimumDistance: PAGE_MIN_DISTANCE,
      step: PAGE_SPIRAL_STEP,
    });
    occupied.push(point);
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
  landmarks: HypermediaLandmark[],
  pages: HypermediaPage[],
): HypermediaLayout {
  const laidOutPages = pageLayouts(landmarks, pages);
  const allPoints = [
    ...landmarks.map(({ point }) => point),
    ...laidOutPages.map(({ point }) => point),
  ];
  if (allPoints.length === 0) {
    return {
      landmarks,
      pages: laidOutPages,
      initialFocus: { x: 0, y: 0 },
      bounds: { x: -450, y: -310, width: INITIAL_VIEW_WIDTH, height: INITIAL_VIEW_HEIGHT },
    };
  }
  const minX = Math.min(...allPoints.map(({ x }) => x)) - MAP_PADDING;
  const maxX = Math.max(...allPoints.map(({ x }) => x)) + MAP_PADDING;
  const minY = Math.min(...allPoints.map(({ y }) => y)) - MAP_PADDING;
  const maxY = Math.max(...allPoints.map(({ y }) => y)) + MAP_PADDING;
  return {
    landmarks,
    pages: laidOutPages,
    initialFocus: landmarks[0]?.point ?? laidOutPages[0]!.point,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}

export function initialHypermediaViewBox(layout: HypermediaLayout): MapBounds {
  return {
    x: layout.initialFocus.x - INITIAL_VIEW_WIDTH / 2,
    y: layout.initialFocus.y - INITIAL_VIEW_HEIGHT / 2,
    width: INITIAL_VIEW_WIDTH,
    height: INITIAL_VIEW_HEIGHT,
  };
}
