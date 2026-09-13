# Animated Context Use logo

`AnimatedContextUseLogo` renders the approved sand, pale coral, and warm stone lighting on a dark canvas. It is decorative; provide the Context Use name in the surrounding content.

```tsx
import { AnimatedContextUseLogo } from './components/brand/animated-context-use-logo';

<AnimatedContextUseLogo className="h-80 w-full rounded-2xl" />
```

The component defaults to a square filling its parent's width. Set its dimensions through `className` when using it as a panel. Its light and SVG geometry scale to the smaller container dimension. The optional `palette` prop accepts `sand` (default), `cool`, or `neon`; the playground uses these same presets.

The light smoothly follows mouse and pen movement across the page, returning to its slow orbit when the pointer leaves the window. Touch scrolling remains native. Reduced motion keeps the light still.

Logo outlines render at display resolution, independently of the lower-resolution diffuse lighting. Retina rendering supports up to 3× pixel density, bounded by 4096 pixels per dimension and an eight-megapixel budget. Glow widths stay consistent across pixel densities.

The renderer loads on mount, pauses when outside the viewport or in a hidden tab, and releases GPU resources and pointer listeners on unmount. A static SVG appears while loading or if WebGPU is unavailable. Rendering does not block surrounding controls.

The Vite WGSL plugin is configured for both the application and the playground. Shader source and the Vercel MIT attribution live in `light/shaders`; colors live in `light/palettes.ts`.
