import type { Palette } from './palettes';

export type Point = readonly [number, number];
export type Shape = {
  readonly center: Point;
  readonly halfSize: Point;
  readonly color: readonly [number, number, number];
};

const LOGO_SCALE = 0.52;
const HALF = 0.5;
// biome-ignore lint/style/noMagicNumbers: Neutral white emission in linear RGB.
const VERTICAL_COLOR = [0.75, 0.75, 0.75] as const;

export function readLogo({ svg, palette }: { svg: string; palette: Palette }) {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = document.documentElement;
  const [x, y, width, height] = root.getAttribute('viewBox')!.split(/\s+/).map(Number);
  const scale = LOGO_SCALE / Math.max(width!, height!);
  const center: Point = [x! + width! * HALF, y! + height! * HALF];
  let horizontalIndex = 0;
  const rectangles = Array.from(root.querySelectorAll('rect')).sort(
    // biome-ignore lint/complexity/useMaxParams: Array.sort supplies the two rectangles being compared.
    (a, b) => Number(a.getAttribute('y')) - Number(b.getAttribute('y')),
  );
  return rectangles.map((rect): Shape => {
    const [rx, ry, rw, rh] = ['x', 'y', 'width', 'height'].map((key) =>
      Number(rect.getAttribute(key)),
    );
    return {
      center: [(rx! + rw! * HALF - center[0]) * scale, (ry! + rh! * HALF - center[1]) * scale],
      halfSize: [rw! * HALF * scale, rh! * HALF * scale],
      color:
        rw! > rh! ? palette.colors[horizontalIndex++ % palette.colors.length]! : VERTICAL_COLOR,
    };
  });
}

export function packShapes(shapes: readonly Shape[]) {
  return new Float32Array(
    shapes.flatMap((shape) => [...shape.center, ...shape.halfSize, ...shape.color, 0]),
  );
}
