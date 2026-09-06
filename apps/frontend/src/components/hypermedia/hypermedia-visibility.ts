// biome-ignore-all lint/style/noMagicNumbers: Viewport thresholds are explicit interaction tuning values.
// biome-ignore-all lint/complexity/useMaxParams: Geometry helpers read more clearly with point pairs and sort callbacks.

import { isEmbeddableAsset } from '../../lib/asset-presentation';
import type { HypermediaResourceReference } from '../../queries/hypermedia';
import { hypermediaResourceKey } from '../../queries/hypermedia';
import type {
  CanvasBounds,
  CanvasPoint,
  HypermediaLayout,
  HypermediaLayoutResource,
} from './hypermedia-layout';

export const MAX_FOCUSED_RESOURCES = 24;
export const MAX_EAGER_HYPERMEDIA_IMAGES = 12;

function viewportCenter(viewport: CanvasBounds): CanvasPoint {
  return { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 };
}

function squaredDistance(first: CanvasPoint, second: CanvasPoint): number {
  return (first.x - second.x) ** 2 + (first.y - second.y) ** 2;
}

function referenceFromResource(resource: HypermediaLayoutResource): HypermediaResourceReference {
  return resource.kind === 'entity'
    ? { kind: 'entity', readableId: resource.entity.readableId }
    : { kind: 'asset', readableId: resource.asset.readableId };
}

export function focusedResources({
  resources,
  viewport,
  selectedKey,
}: {
  resources: HypermediaLayoutResource[];
  viewport: CanvasBounds;
  selectedKey?: string;
}): HypermediaResourceReference[] {
  const center = viewportCenter(viewport);
  const ordered = resources
    .filter(
      (resource) => resource.key === selectedKey || pointNearViewport(resource.point, viewport),
    )
    .sort(
      (first, second) =>
        Number(second.key === selectedKey) - Number(first.key === selectedKey) ||
        squaredDistance(first.point, center) - squaredDistance(second.point, center) ||
        first.key.localeCompare(second.key),
    );
  return ordered.slice(0, MAX_FOCUSED_RESOURCES).map(referenceFromResource);
}

export function viewportNearResourceBoundary(
  viewport: CanvasBounds,
  bounds: CanvasBounds,
): boolean {
  const marginX = Math.min(viewport.width * 0.16, bounds.width * 0.2);
  const marginY = Math.min(viewport.height * 0.16, bounds.height * 0.2);
  return (
    viewport.x <= bounds.x + marginX ||
    viewport.y <= bounds.y + marginY ||
    viewport.x + viewport.width >= bounds.x + bounds.width - marginX ||
    viewport.y + viewport.height >= bounds.y + bounds.height - marginY
  );
}

export function nearestBoundaryResource(
  resources: HypermediaLayoutResource[],
  viewport: CanvasBounds,
): HypermediaResourceReference | undefined {
  const center = viewportCenter(viewport);
  const nearest = [...resources].sort(
    (first, second) =>
      squaredDistance(first.point, center) - squaredDistance(second.point, center) ||
      first.key.localeCompare(second.key),
  )[0];
  return nearest ? referenceFromResource(nearest) : undefined;
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

export function viewportNeedsResourceDiscovery({
  resources,
  viewport,
  bounds,
}: {
  resources: HypermediaLayoutResource[];
  viewport: CanvasBounds;
  bounds: CanvasBounds;
}): boolean {
  if (!viewportNearResourceBoundary(viewport, bounds)) {
    return false;
  }
  const targetEntityCount = Math.max(
    4,
    Math.floor(viewport.width / 180) * Math.floor(viewport.height / 140),
  );
  const nearbyEntityCount = resources.filter(
    (resource) => resource.kind === 'entity' && pointNearViewport(resource.point, viewport),
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
  const visibleResourceKeys = new Set(
    layout.resources
      .filter(
        (resource) => resource.key === selectedKey || pointNearViewport(resource.point, viewport),
      )
      .map(({ key }) => key),
  );
  return {
    ...layout,
    resources: layout.resources.filter(({ key }) => visibleResourceKeys.has(key)),
    pages: layout.pages.filter(
      ({ page, point, resourceKeys }) =>
        `page:${page.readableId}` === selectedKey ||
        resourceKeys.some((key) => visibleResourceKeys.has(key)) ||
        (resourceKeys.length === 0 && pointNearViewport(point, viewport)),
    ),
  };
}

export function eagerHypermediaImageKeys(layout: HypermediaLayout): Set<string> {
  return new Set(
    layout.resources
      .filter((resource) =>
        resource.kind === 'entity'
          ? Boolean(resource.entity.image)
          : isEmbeddableAsset(resource.asset),
      )
      .slice(0, MAX_EAGER_HYPERMEDIA_IMAGES)
      .map((resource) => hypermediaResourceKey(referenceFromResource(resource))),
  );
}
