# Animated Context Use logo

`AnimatedContextUseLogo` renders the approved sand, pale coral, and warm stone lighting on a dark canvas. It is decorative; provide the Context Use name in the surrounding content.

```tsx
import { AnimatedContextUseLogo } from './components/brand/animated-context-use-logo';

<AnimatedContextUseLogo className="h-80 w-full rounded-2xl" />
```

The component defaults to a square filling its parent's width. Set its dimensions through `className` when using it as a panel. Its light and SVG geometry scale to the smaller container dimension. The optional `palette` prop accepts `sand` (default), `cool`, or `neon`; the playground uses these same presets.

The renderer loads on mount, respects reduced motion, pauses when outside the viewport or in a hidden tab, and releases GPU resources on unmount. A static SVG appears while loading or if WebGPU is unavailable. Rendering does not block surrounding controls.

The Vite WGSL plugin is configured for both the application and the playground. Shader source and the Vercel MIT attribution live in `light/shaders`; colors live in `light/palettes.ts`.
