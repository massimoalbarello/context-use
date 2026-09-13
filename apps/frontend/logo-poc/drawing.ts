export type Point = readonly [number, number];
export type Shape = {
  readonly center: Point;
  readonly halfSize: Point;
  readonly color: readonly [number, number, number];
  readonly logo: boolean;
};

const LOGO_SCALE = 0.52;
const HALF = 0.5;
// biome-ignore-start lint/style/noMagicNumbers: The named palette is the artistic configuration of linear RGB colors.
const PALETTE = [
  [0.08, 0.8, 1.4],
  [1.5, 0.24, 0.06],
  [0.65, 0.16, 1.5],
  [0.12, 1.1, 0.6],
  [1.2, 0.14, 0.5],
] as const;
// biome-ignore-end lint/style/noMagicNumbers: End of linear RGB palette.

export function readLogo(svg: string) {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = document.documentElement;
  const [x, y, width, height] = root.getAttribute('viewBox')!.split(/\s+/).map(Number);
  const scale = LOGO_SCALE / Math.max(width!, height!);
  const center: Point = [x! + width! * HALF, y! + height! * HALF];
  const shapes: Shape[] = Array.from(root.querySelectorAll('rect'), (rect) => {
    const [rx, ry, rw, rh] = ['x', 'y', 'width', 'height'].map((key) =>
      Number(rect.getAttribute(key)),
    );
    return {
      center: [(rx! + rw! * HALF - center[0]) * scale, (ry! + rh! * HALF - center[1]) * scale],
      halfSize: [rw! * HALF * scale, rh! * HALF * scale],
      color: [0, 0, 0],
      logo: true,
    };
  });
  return {
    shapes,
    horizontalHalfWidth: Math.max(
      ...shapes.filter((s) => s.halfSize[0] > s.halfSize[1]).map((s) => s.halfSize[1]),
    ),
    verticalHalfWidth: Math.max(
      ...shapes.filter((s) => s.halfSize[1] > s.halfSize[0]).map((s) => s.halfSize[0]),
    ),
  };
}

export function makeStroke({
  from,
  to,
  horizontal,
  index,
  thickness,
}: {
  from: Point;
  to: Point;
  horizontal: boolean;
  index: number;
  thickness: number;
}): Shape {
  return {
    center: horizontal ? [(from[0] + to[0]) * HALF, from[1]] : [from[0], (from[1] + to[1]) * HALF],
    halfSize: horizontal
      ? [Math.abs(to[0] - from[0]) * HALF, thickness]
      : [thickness, Math.abs(to[1] - from[1]) * HALF],
    color: PALETTE[index % PALETTE.length]!,
    logo: false,
  };
}

export function packShapes(shapes: readonly Shape[]) {
  return new Float32Array(
    shapes.flatMap((shape) => [
      ...shape.center,
      ...shape.halfSize,
      ...shape.color,
      Number(shape.logo),
    ]),
  );
}
