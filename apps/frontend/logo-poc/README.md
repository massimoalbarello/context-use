# Context Use light playground

A standalone vgpu proof of concept. Run `bun --filter @repo/frontend logo:dev` from the repository root and open the printed local URL. Build with `bun --filter @repo/frontend logo:build`; the static output is in `logo-poc/dist`.

Drag to draw. The first movement chooses the horizontal or vertical axis; colors cycle per stroke. Horizontal bars and vertical lines inherit their thickness from the existing logo SVG. Reload to clear everything. There are no controls or persisted drawings.

The logo receives a moving rim light and radial scattering inspired by [Next.js Flare](https://vgpu.sh/examples/nextjs-flare). Drawn strokes emit light through six [Radiance Cascades](https://vgpu.sh/examples/radiance-cascades), with the logo acting as an occluder. The rectangular geometry supplies an analytic distance field. Lighting is recalculated when the drawing changes; the flare animates independently. The shaders `radiance-cascade.wgsl`, `rc-directions.wgsl`, and `sdf-sample.wgsl` are adapted from Vercel's MIT-licensed example; see `shaders/LICENSE`.

Requires WebGPU for the interactive scene. If GPU initialization or rendering fails, the page displays the original SVG. Reduced motion freezes the autonomous light while retaining drawing. Resizing preserves the drawing in coordinates relative to the logo. This experiment has its own Vite entry point and is not included in the application build.
