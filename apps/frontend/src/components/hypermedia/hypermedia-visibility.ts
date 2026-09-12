// biome-ignore-all lint/style/noMagicNumbers: Viewport thresholds are explicit interaction tuning values.
// biome-ignore-all lint/complexity/useMaxParams: Geometry helpers read more clearly with point pairs and sort callbacks.

import {
  type HypermediaEntityReference,
  hypermediaEntityReference,
} from '../../queries/hypermedia';
import type {
  CanvasBounds,
  CanvasPoint,
  HypermediaLayout,
  HypermediaLayoutEntity,
} from './hypermedia-layout';
import { hypermediaSelectionKey } from './hypermedia-selection';

export type SettledHypermediaViewport = {
  focus: HypermediaEntityReference[];
  discoverMoreEntities: boolean;
  boundaryAnchor?: HypermediaEntityReference;
};

const MAX_FOCUSED_ENTITIES = 24;

function viewportCenter(viewport: CanvasBounds): CanvasPoint {
  return { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 };
}

function squaredDistance(first: CanvasPoint, second: CanvasPoint): number {
  return (first.x - second.x) ** 2 + (first.y - second.y) ** 2;
}

export function focusedEntities({
  entities,
  viewport,
  selectedKey,
}: {
  entities: HypermediaLayoutEntity[];
  viewport: CanvasBounds;
  selectedKey?: string;
}): HypermediaEntityReference[] {
  const center = viewportCenter(viewport);
  const ordered = entities
    .filter((entity) => entity.key === selectedKey || pointNearViewport(entity.point, viewport))
    .sort(
      (first, second) =>
        Number(second.key === selectedKey) - Number(first.key === selectedKey) ||
        squaredDistance(first.point, center) - squaredDistance(second.point, center) ||
        first.key.localeCompare(second.key),
    );
  return ordered
    .slice(0, MAX_FOCUSED_ENTITIES)
    .map(({ entity }) => hypermediaEntityReference(entity));
}

function viewportNearEntityBoundary(viewport: CanvasBounds, bounds: CanvasBounds): boolean {
  const marginX = Math.min(viewport.width * 0.16, bounds.width * 0.2);
  const marginY = Math.min(viewport.height * 0.16, bounds.height * 0.2);
  return (
    viewport.x <= bounds.x + marginX ||
    viewport.y <= bounds.y + marginY ||
    viewport.x + viewport.width >= bounds.x + bounds.width - marginX ||
    viewport.y + viewport.height >= bounds.y + bounds.height - marginY
  );
}

export function nearestBoundaryEntity(
  entities: HypermediaLayoutEntity[],
  viewport: CanvasBounds,
): HypermediaEntityReference | undefined {
  const center = viewportCenter(viewport);
  const nearest = [...entities].sort(
    (first, second) =>
      squaredDistance(first.point, center) - squaredDistance(second.point, center) ||
      first.key.localeCompare(second.key),
  )[0];
  return nearest ? hypermediaEntityReference(nearest.entity) : undefined;
}

function pointNearViewport(point: CanvasPoint, viewport: CanvasBounds): boolean {
  const marginX = viewport.width * 0.16;
  const marginY = viewport.height * 0.16;
  return (
    point.x >= viewport.x - marginX &&
    point.x <= viewport.x + viewport.width + marginX &&
    point.y >= viewport.y - marginY &&
    point.y <= viewport.y + viewport.height + marginY
  );
}

export function viewportNeedsEntityDiscovery({
  entities,
  viewport,
  bounds,
}: {
  entities: HypermediaLayoutEntity[];
  viewport: CanvasBounds;
  bounds: CanvasBounds;
}): boolean {
  if (!viewportNearEntityBoundary(viewport, bounds)) {
    return false;
  }
  const targetEntityCount = Math.max(
    4,
    Math.floor(viewport.width / 180) * Math.floor(viewport.height / 140),
  );
  const nearbyEntityCount = entities.filter((entity) =>
    pointNearViewport(entity.point, viewport),
  ).length;
  return nearbyEntityCount < targetEntityCount;
}

export function hypermediaLayoutInViewport({
  layout,
  viewport,
  selectedKey,
}: {
  layout: HypermediaLayout;
  viewport: CanvasBounds;
  selectedKey?: string;
}): HypermediaLayout {
  const visibleEntityKeys = new Set(
    layout.entities
      .filter((entity) => entity.key === selectedKey || pointNearViewport(entity.point, viewport))
      .map(({ key }) => key),
  );
  return {
    ...layout,
    entities: layout.entities.filter(({ key }) => visibleEntityKeys.has(key)),
    pages: layout.pages.filter(
      ({ page, point, entityKeys }) =>
        hypermediaSelectionKey({ kind: 'page', readableId: page.readableId }) === selectedKey ||
        entityKeys.some((key) => visibleEntityKeys.has(key)) ||
        (entityKeys.length === 0 && pointNearViewport(point, viewport)),
    ),
  };
}
