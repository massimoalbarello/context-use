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

function focusedResourceLimit(viewport: CanvasBounds): number {
  if (viewport.width <= 1100) {
    return 8;
  }
  if (viewport.width <= 1450) {
    return 12;
  }
  if (viewport.width <= 1850) {
    return 16;
  }
  if (viewport.width <= 2300) {
    return 20;
  }
  return MAX_FOCUSED_RESOURCES;
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
  const ordered = [...resources].sort(
    (first, second) =>
      Number(second.key === selectedKey) - Number(first.key === selectedKey) ||
      squaredDistance(first.point, center) - squaredDistance(second.point, center) ||
      first.key.localeCompare(second.key),
  );
  return ordered.slice(0, focusedResourceLimit(viewport)).map(referenceFromResource);
}

export function focusedPageLimit(viewport: CanvasBounds): number {
  if (viewport.width <= 720) {
    return 4;
  }
  if (viewport.width <= 1100) {
    return 8;
  }
  if (viewport.width <= 1450) {
    return 12;
  }
  if (viewport.width <= 1850) {
    return 16;
  }
  if (viewport.width <= 2300) {
    return 20;
  }
  return 32;
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

export function hypermediaLayoutInViewport({
  layout,
  viewport,
  selectedKey,
}: {
  layout: HypermediaLayout;
  viewport: CanvasBounds;
  selectedKey?: string;
}): HypermediaLayout {
  return {
    ...layout,
    resources: layout.resources.filter(
      (resource) => resource.key === selectedKey || pointNearViewport(resource.point, viewport),
    ),
    pages: layout.pages.filter(
      ({ page, point }) =>
        `page:${page.readableId}` === selectedKey || pointNearViewport(point, viewport),
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
