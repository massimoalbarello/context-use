import { type Gpu, init, surface } from 'vgpu';
import logoSvg from '../../../assets/context-use.svg?raw';
import { type Point, readLogo } from './logo';
import type { Palette } from './palettes';
import { createPipeline } from './pipeline';
import { createAdaptiveQuality } from './quality';

export type RendererStatus = 'loading' | 'ready' | 'unavailable';

const MAX_OUTPUT_DIMENSION = 4096;
const MAX_OUTPUT_PIXELS = 8_388_608;
const MAX_DPR = 3;
const MILLISECONDS_PER_SECOND = 1000;
const INITIAL_LIGHT_X = 0.16;
const INITIAL_LIGHT_Y = -0.14;
const INITIAL_LIGHT: Point = [INITIAL_LIGHT_X, INITIAL_LIGHT_Y];
const ORBIT_SPEED = 0.24;
const ORBIT_RADIUS = 0.22;
const VERTICAL_ORBIT_RATIO = 0.85;
const POINTER_RESPONSE = 10;
const MAX_FRAME_SECONDS = 0.05;

export function createRenderer({
  canvas,
  palette,
  onStatus,
}: {
  canvas: HTMLCanvasElement;
  palette: Palette;
  onStatus: (status: RendererStatus) => void;
}) {
  let disposed = false;
  let gpu: Gpu | undefined;
  let animationFrame = 0;
  const cleanups: (() => void)[] = [];

  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    cancelAnimationFrame(animationFrame);
    for (const cleanup of cleanups.reverse()) {
      cleanup();
    }
    gpu?.dispose();
  };
  const fail = (error: unknown) => {
    if (disposed) {
      return;
    }
    console.error('Context Use logo lighting:', error);
    onStatus('unavailable');
    dispose();
  };

  const initialize = async () => {
    const nextGpu = await init();
    if (disposed) {
      nextGpu.dispose();
      return;
    }
    gpu = nextGpu;
    cleanups.push(gpu.onError(fail));
    const output = surface(gpu, canvas, { autoResize: false });
    const quality = createAdaptiveQuality();
    const pipeline = createPipeline({
      gpu,
      output,
      shapes: readLogo({ svg: logoSvg, palette }),
    });
    let sceneChanged = true;
    let needsResize = true;
    let inFlight = false;
    let visible = true;
    let hasRendered = false;
    let pointer: Point | undefined;
    let light: Point = INITIAL_LIGHT;
    let previousTime = 0;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let currentDpr = window.devicePixelRatio;

    const schedule = () => {
      if (!disposed && !animationFrame && !inFlight && !document.hidden && visible) {
        animationFrame = requestAnimationFrame(tick);
      }
    };
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const scale = Math.min(
        dpr,
        Math.min(MAX_OUTPUT_DIMENSION, nextGpu.gpu.limits.maxTextureDimension2D) /
          Math.max(bounds.width, bounds.height, 1),
        Math.sqrt(MAX_OUTPUT_PIXELS / Math.max(bounds.width * bounds.height, 1)),
      );
      pipeline.resize({
        size: [
          Math.max(1, Math.round(bounds.width * scale)),
          Math.max(1, Math.round(bounds.height * scale)),
        ],
        ratio: scale,
        quality: quality.current,
      });
      canvas.dataset.lightQuality = quality.current.name;
      quality.reset();
      sceneChanged = true;
      needsResize = false;
      currentDpr = window.devicePixelRatio;
    };
    const draw = (now: number) => {
      if (needsResize || currentDpr !== window.devicePixelRatio) {
        resize();
      }
      const time = motion.matches ? 0 : now / MILLISECONDS_PER_SECOND;
      const target: Point = pointer ?? [
        Math.cos(time * ORBIT_SPEED) * ORBIT_RADIUS,
        Math.sin(time * ORBIT_SPEED) * ORBIT_RADIUS * VERTICAL_ORBIT_RATIO,
      ];
      const elapsed = Math.min((now - previousTime) / MILLISECONDS_PER_SECOND, MAX_FRAME_SECONDS);
      const follow = 1 - Math.exp(-POINTER_RESPONSE * elapsed);
      light = motion.matches
        ? INITIAL_LIGHT
        : [light[0] + (target[0] - light[0]) * follow, light[1] + (target[1] - light[1]) * follow];
      previousTime = now;
      pipeline.render({ light, sceneChanged });
      sceneChanged = false;
    };
    const updateQuality = () => {
      if (motion.matches || document.hidden || !visible) {
        quality.reset();
        return;
      }
      if (quality.sample(performance.now())) {
        needsResize = true;
      }
    };
    function tick(now: number) {
      animationFrame = 0;
      if (disposed || document.hidden || !visible) {
        return;
      }
      inFlight = true;
      try {
        draw(now);
        void nextGpu.gpu.queue
          .onSubmittedWorkDone()
          .then(() => {
            inFlight = false;
            if (disposed) {
              return;
            }
            if (!hasRendered) {
              hasRendered = true;
              onStatus('ready');
            }
            updateQuality();
            if (!motion.matches || sceneChanged || needsResize) {
              schedule();
            }
          })
          .catch(fail);
      } catch (error) {
        fail(error);
      }
    }

    resize();
    await pipeline.prepare();
    if (disposed) {
      return;
    }
    const observer = new ResizeObserver(() => {
      needsResize = true;
      schedule();
    });
    observer.observe(canvas);
    cleanups.push(() => observer.disconnect());
    const resume = () => {
      quality.reset();
      sceneChanged = true;
      schedule();
    };
    document.addEventListener('visibilitychange', resume);
    motion.addEventListener('change', resume);
    cleanups.push(() => document.removeEventListener('visibilitychange', resume));
    cleanups.push(() => motion.removeEventListener('change', resume));
    const movePointer = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || motion.matches || !visible || document.hidden) {
        return;
      }
      const bounds = canvas.getBoundingClientRect();
      const unit = Math.max(1, Math.min(bounds.width, bounds.height));
      pointer = [
        (event.clientX - bounds.left - bounds.width / 2) / unit,
        (event.clientY - bounds.top - bounds.height / 2) / unit,
      ];
      schedule();
    };
    const resetPointer = () => {
      pointer = undefined;
    };
    window.addEventListener('pointermove', movePointer, { passive: true });
    window.addEventListener('blur', resetPointer);
    document.documentElement.addEventListener('pointerleave', resetPointer);
    motion.addEventListener('change', resetPointer);
    cleanups.push(() => window.removeEventListener('pointermove', movePointer));
    cleanups.push(() => window.removeEventListener('blur', resetPointer));
    cleanups.push(() => document.documentElement.removeEventListener('pointerleave', resetPointer));
    cleanups.push(() => motion.removeEventListener('change', resetPointer));
    void gpu.gpu.lost.then(() => fail(new Error('WebGPU device lost')));
    const visibility = new IntersectionObserver(([entry]) => {
      quality.reset();
      visible = Boolean(entry?.isIntersecting);
      if (visible) {
        schedule();
      }
    });
    visibility.observe(canvas);
    cleanups.push(() => visibility.disconnect());
    schedule();
  };

  void initialize().catch(fail);
  return { dispose };
}
