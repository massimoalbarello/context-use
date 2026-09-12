// biome-ignore-all lint/style/noMagicNumbers: The deterministic Hypermedia geometry is defined by visual constants.
// biome-ignore-all lint/complexity/useMaxParams: Geometry helpers read more clearly with point pairs and collection indexes.

import type {
  HypermediaEntity,
  HypermediaEntityNeighborhood,
  HypermediaPage,
} from '../../queries/hypermedia';
import { hypermediaEntityKey, hypermediaEntityReference } from '../../queries/hypermedia';
import { hypermediaSelectionKey } from './hypermedia-selection';

export type CanvasPoint = { x: number; y: number };
export type CanvasBounds = CanvasPoint & { width: number; height: number };

export type HypermediaLayoutEntity = {
  entity: HypermediaEntity;
  key: string;
  point: CanvasPoint;
};

type HypermediaPageLayout = {
  page: HypermediaPage;
  point: CanvasPoint;
  cloudPath: string;
  entityKeys: string[];
};

export type HypermediaLayout = {
  entities: HypermediaLayoutEntity[];
  pages: HypermediaPageLayout[];
  entityBounds: CanvasBounds;
};

const CANVAS_PADDING = 160;
const INITIAL_VIEW_WIDTH = 900;
const INITIAL_VIEW_HEIGHT = 620;
const ENTITY_MIN_DISTANCE = 150;
const ENTITY_SPIRAL_STEP = 56;
const PAGE_SPIRAL_STEP = 76;
const ENTITY_RESERVED_WIDTH = 200;
const ENTITY_RESERVED_HEIGHT = 144;
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

function entityArea(entity: HypermediaLayoutEntity): CanvasArea {
  return {
    point: entity.point,
    halfWidth: ENTITY_RESERVED_WIDTH / 2,
    halfHeight: ENTITY_RESERVED_HEIGHT / 2,
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

function entityAt(entity: HypermediaEntity, point: CanvasPoint): HypermediaLayoutEntity {
  const key = hypermediaEntityKey(hypermediaEntityReference(entity));
  return { entity, key, point };
}

function samePositionedEntity(
  first: HypermediaLayoutEntity,
  second: HypermediaLayoutEntity,
): boolean {
  if (
    first.key !== second.key ||
    first.point.x !== second.point.x ||
    first.point.y !== second.point.y
  ) {
    return false;
  }
  return first.entity === second.entity;
}

export function buildStableEntities(
  neighborhoods: HypermediaEntityNeighborhood[],
  standaloneEntities: HypermediaEntity[] = [],
  previousEntities: HypermediaLayoutEntity[] = [],
): HypermediaLayoutEntity[] {
  const entities = new Map<string, HypermediaLayoutEntity>();
  const placed: CanvasPoint[] = [];
  const neighborCountByAnchor = new Map<string, number>();

  const availableKeys = new Set(
    neighborhoods.flatMap((neighborhood) => [
      hypermediaEntityKey(hypermediaEntityReference(neighborhood.anchor)),
      ...neighborhood.neighbors.map(({ entity }) =>
        hypermediaEntityKey(hypermediaEntityReference(entity)),
      ),
    ]),
  );
  for (const entity of standaloneEntities) {
    availableKeys.add(hypermediaEntityKey(hypermediaEntityReference(entity)));
  }
  for (const entity of previousEntities) {
    if (availableKeys.has(entity.key)) {
      entities.set(entity.key, entity);
      placed.push(entity.point);
    }
  }

  function addAnchor(entity: HypermediaEntity): HypermediaLayoutEntity {
    const key = hypermediaEntityKey(hypermediaEntityReference(entity));
    const existing = entities.get(key);
    if (existing) {
      const refreshed = entityAt(entity, existing.point);
      entities.set(key, refreshed);
      return refreshed;
    }
    const index = entities.size;
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
      step: ENTITY_SPIRAL_STEP,
      isAvailable: (candidate) =>
        placed.every((placedPoint) => distance(candidate, placedPoint) >= ENTITY_MIN_DISTANCE),
    });
    const positionedEntity = entityAt(entity, point);
    entities.set(key, positionedEntity);
    placed.push(point);
    return positionedEntity;
  }

  for (const neighborhood of neighborhoods) {
    const anchor = addAnchor(neighborhood.anchor);
    const anchorOffset = neighborCountByAnchor.get(anchor.key) ?? 0;
    for (const [index, neighbor] of neighborhood.neighbors.entries()) {
      const key = hypermediaEntityKey(hypermediaEntityReference(neighbor.entity));
      if (entities.has(key)) {
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
        step: ENTITY_SPIRAL_STEP,
        isAvailable: (candidate) =>
          placed.every((placedPoint) => distance(candidate, placedPoint) >= ENTITY_MIN_DISTANCE),
      });
      entities.set(key, entityAt(neighbor.entity, point));
      placed.push(point);
    }
    neighborCountByAnchor.set(anchor.key, anchorOffset + neighborhood.neighbors.length);
  }

  for (const entity of standaloneEntities) {
    addAnchor(entity);
  }

  const nextEntities = [...entities.values()];
  return previousEntities.length === nextEntities.length &&
    previousEntities.every((entity, index) => samePositionedEntity(entity, nextEntities[index]!))
    ? previousEntities
    : nextEntities;
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
  entities: HypermediaLayoutEntity[],
  pages: HypermediaPage[],
): HypermediaPageLayout[] {
  const pointsByKey = new Map(entities.map((entity) => [entity.key, entity.point]));
  const occupiedAreas = entities.map(entityArea);
  return pages.map((page, index) => {
    const entityKeys = page.entities.map(hypermediaEntityKey);
    const connectedPoints = entityKeys.flatMap((key) => {
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
      key: hypermediaSelectionKey({ kind: 'page', readableId: page.readableId }),
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
      entityKeys,
    };
  });
}

export function buildHypermediaLayout(
  entities: HypermediaLayoutEntity[],
  pages: HypermediaPage[],
): HypermediaLayout {
  const laidOutPages = pageLayouts(entities, pages);
  const boundedEntityPoints = (entities.length > 0 ? entities : laidOutPages).map(
    ({ point }) => point,
  );
  if (boundedEntityPoints.length === 0) {
    return {
      entities,
      pages: laidOutPages,
      entityBounds: initialHypermediaViewBox(entities),
    };
  }
  const entityMinX = Math.min(...boundedEntityPoints.map(({ x }) => x)) - CANVAS_PADDING;
  const entityMaxX = Math.max(...boundedEntityPoints.map(({ x }) => x)) + CANVAS_PADDING;
  const entityMinY = Math.min(...boundedEntityPoints.map(({ y }) => y)) - CANVAS_PADDING;
  const entityMaxY = Math.max(...boundedEntityPoints.map(({ y }) => y)) + CANVAS_PADDING;
  return {
    entities,
    pages: laidOutPages,
    entityBounds: {
      x: entityMinX,
      y: entityMinY,
      width: entityMaxX - entityMinX,
      height: entityMaxY - entityMinY,
    },
  };
}

export function initialHypermediaViewBox(entities: HypermediaLayoutEntity[]): CanvasBounds {
  const focus = entities[0]?.point ?? { x: 0, y: 0 };
  return {
    x: focus.x - INITIAL_VIEW_WIDTH / 2,
    y: focus.y - INITIAL_VIEW_HEIGHT / 2,
    width: INITIAL_VIEW_WIDTH,
    height: INITIAL_VIEW_HEIGHT,
  };
}

export function zoomedHypermediaViewBox({
  current,
  factor,
  anchor,
  minimumWidth,
  maximumWidth,
}: {
  current: CanvasBounds;
  factor: number;
  anchor: CanvasPoint;
  minimumWidth: number;
  maximumWidth: number;
}): CanvasBounds {
  const width = Math.min(maximumWidth, Math.max(minimumWidth, current.width * factor));
  if (width === current.width) {
    return current;
  }
  const height = width * (current.height / current.width);
  const anchorX = current.x + current.width * anchor.x;
  const anchorY = current.y + current.height * anchor.y;
  return {
    x: anchorX - width * anchor.x,
    y: anchorY - height * anchor.y,
    width,
    height,
  };
}
