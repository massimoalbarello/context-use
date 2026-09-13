# Context Use logo light study

A standalone vgpu proof of concept. Run `bun --filter @repo/frontend logo:dev` from the repository root and open the printed local URL. Build with `bun --filter @repo/frontend logo:build`; the static output is in `logo-poc/dist`.

The original logo is the entire scene. Vertical strokes emit white light; each horizontal bar emits a different color. A slow autonomous flare carries those colors into the surrounding haze while preserving the logo's dark interiors. There are no drawing gestures or controls.

Compare three palettes with the same geometry and animation (colors listed top to bottom):

| Study | Local URL | Horizontal colors |
| --- | --- | --- |
| Cool | http://127.0.0.1:4174/ | Ice blue, mint green, lavender |
| Sand | http://127.0.0.1:4174/warm.html | Sand beige, pale coral, warm stone grey |
| Neon | http://127.0.0.1:4174/neon.html | Cyan, electric blue, magenta |

All three pages are included in the static build. Color values are defined together in `palettes.ts`.

Geometry comes from the existing SVG, with colors assigned by orientation and vertical order. The colored rim and radial scattering are inspired by [Next.js Flare](https://vgpu.sh/examples/nextjs-flare). Six [Radiance Cascades](https://vgpu.sh/examples/radiance-cascades) illuminate the background from the logo's strokes; this field is recalculated only on resize. The shaders `radiance-cascade.wgsl`, `rc-directions.wgsl`, and `sdf-sample.wgsl` are adapted from Vercel's MIT-licensed example; see `shaders/LICENSE`.

Requires WebGPU for animation. If GPU initialization or rendering fails, the page displays the original SVG. Reduced motion freezes the light, and hidden pages pause rendering. This experiment has its own Vite entry point and is not included in the application build.
