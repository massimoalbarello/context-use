// biome-ignore-all lint/style/noMagicNumbers: Viewport thresholds are explicit interaction tuning values.
// biome-ignore-all lint/complexity/useMaxParams: Geometry helpers read more clearly with point pairs and sort callbacks.

import { isEmbeddableAsset } from '../../lib/asset-presentation';
import type { HypermediaResourceReference } from '../../queries/hypermedia';
import { hypermediaResourceKey } from '../../queries/hypermedia';
import type {
  HypermediaLandmark,
  HypermediaLayout,
  MapBounds,
  MapPoint,
} from './hypermedia-layout';

export const MAX_FOCUSED_LANDMARKS = 24;
export const MAX_EAGER_HYPERMEDIA_IMAGES = 12;

function viewportCenter(viewport: MapBounds): MapPoint {
  return { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 };
}

function squaredDistance(first: MapPoint, second: MapPoint): number {
  return (first.x - second.x) ** 2 + (first.y - second.y) ** 2;
}

function referenceFromLandmark(landmark: HypermediaLandmark): HypermediaResourceReference {
  return landmark.kind === 'entity'
    ? { kind: 'entity', readableId: landmark.entity.readableId }
    : { kind: 'asset', readableId: landmark.asset.readableId };
}

function focusedLandmarkLimit(viewport: MapBounds): number {
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
  return MAX_FOCUSED_LANDMARKS;
}

export function focusedLandmarks({
  landmarks,
  viewport,
  selectedKey,
}: {
  landmarks: HypermediaLandmark[];
  viewport: MapBounds;
  selectedKey?: string;
}): HypermediaResourceReference[] {
  const center = viewportCenter(viewport);
  const ordered = [...landmarks].sort(
    (first, second) =>
      Number(second.key === selectedKey) - Number(first.key === selectedKey) ||
      squaredDistance(first.point, center) - squaredDistance(second.point, center) ||
      first.key.localeCompare(second.key),
  );
  return ordered.slice(0, focusedLandmarkLimit(viewport)).map(referenceFromLandmark);
}

export function focusedPageLimit(viewport: MapBounds): number {
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

export function viewportNearLandmarkBoundary(viewport: MapBounds, bounds: MapBounds): boolean {
  const marginX = Math.min(viewport.width * 0.16, bounds.width * 0.2);
  const marginY = Math.min(viewport.height * 0.16, bounds.height * 0.2);
  return (
    viewport.x <= bounds.x + marginX ||
    viewport.y <= bounds.y + marginY ||
    viewport.x + viewport.width >= bounds.x + bounds.width - marginX ||
    viewport.y + viewport.height >= bounds.y + bounds.height - marginY
  );
}

export function nearestBoundaryLandmark(
  landmarks: HypermediaLandmark[],
  viewport: MapBounds,
): HypermediaResourceReference | undefined {
  const center = viewportCenter(viewport);
  const nearest = [...landmarks].sort(
    (first, second) =>
      squaredDistance(first.point, center) - squaredDistance(second.point, center) ||
      first.key.localeCompare(second.key),
  )[0];
  return nearest ? referenceFromLandmark(nearest) : undefined;
}

function pointNearViewport(point: MapPoint, viewport: MapBounds): boolean {
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
  viewport: MapBounds;
  selectedKey?: string;
}): HypermediaLayout {
  return {
    ...layout,
    landmarks: layout.landmarks.filter(
      (landmark) => landmark.key === selectedKey || pointNearViewport(landmark.point, viewport),
    ),
    pages: layout.pages.filter(
      ({ page, point }) =>
        `page:${page.readableId}` === selectedKey || pointNearViewport(point, viewport),
    ),
  };
}

export function eagerHypermediaImageKeys(layout: HypermediaLayout): Set<string> {
  return new Set(
    layout.landmarks
      .filter((landmark) =>
        landmark.kind === 'entity'
          ? Boolean(landmark.entity.image)
          : isEmbeddableAsset(landmark.asset),
      )
      .slice(0, MAX_EAGER_HYPERMEDIA_IMAGES)
      .map((landmark) => hypermediaResourceKey(referenceFromLandmark(landmark))),
  );
}
