import { type Gpu, init, surface } from 'vgpu';
import logoSvg from '../src/assets/context-use.svg?raw';
import { type Point, readLogo } from './drawing';
import { createPipeline } from './pipeline';
import { installDrawing } from './pointer-input';

const MAX_OUTPUT_DIMENSION = 1920;
const MAX_DPR = 2;
const MILLISECONDS_PER_SECOND = 1000;
const INITIAL_LIGHT_X = 0.16;
const INITIAL_LIGHT_Y = -0.14;
const INITIAL_LIGHT: Point = [INITIAL_LIGHT_X, INITIAL_LIGHT_Y];
const ORBIT_SPEED = 0.24;
const ORBIT_RADIUS = 0.22;
const VERTICAL_ORBIT_RATIO = 0.85;
const LIGHT_EASING = 0.055;

export function createRenderer({
  canvas,
  onStatus,
}: {
  canvas: HTMLCanvasElement;
  onStatus: (status: string) => void;
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
    console.error('Context Use light playground:', error);
    onStatus('Live lighting is unavailable in this browser. Try a browser with WebGPU enabled.');
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
    const pipeline = createPipeline({ gpu, output });
    const logo = readLogo(logoSvg);
    let sceneChanged = true;
    let needsResize = true;
    let inFlight = false;
    let pointer: Point | undefined;
    let light = INITIAL_LIGHT;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let currentDpr = window.devicePixelRatio;

    const schedule = () => {
      if (!disposed && !animationFrame && !inFlight && !document.hidden) {
        animationFrame = requestAnimationFrame(tick);
      }
    };
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const scale = Math.min(dpr, MAX_OUTPUT_DIMENSION / Math.max(bounds.width, bounds.height));
      pipeline.resize([
        Math.max(1, Math.round(bounds.width * scale)),
        Math.max(1, Math.round(bounds.height * scale)),
      ]);
      sceneChanged = true;
      needsResize = false;
      currentDpr = window.devicePixelRatio;
    };
    const draw = (now: number) => {
      if (needsResize || currentDpr !== window.devicePixelRatio) {
        resize();
      }
      const time = motion.matches ? 0 : now / MILLISECONDS_PER_SECOND;
      const desired: Point = motion.matches
        ? INITIAL_LIGHT
        : (pointer ?? [
            Math.cos(time * ORBIT_SPEED) * ORBIT_RADIUS,
            Math.sin(time * ORBIT_SPEED) * ORBIT_RADIUS * VERTICAL_ORBIT_RATIO,
          ]);
      light = [
        light[0] + (desired[0] - light[0]) * LIGHT_EASING,
        light[1] + (desired[1] - light[1]) * LIGHT_EASING,
      ];
      pipeline.render({ light, time, sceneChanged });
      sceneChanged = false;
    };
    function tick(now: number) {
      animationFrame = 0;
      if (disposed || document.hidden) {
        return;
      }
      inFlight = true;
      try {
        draw(now);
        void nextGpu.gpu.queue
          .onSubmittedWorkDone()
          .then(() => {
            inFlight = false;
            if (!motion.matches || sceneChanged || needsResize) {
              schedule();
            }
          })
          .catch(fail);
      } catch (error) {
        fail(error);
      }
    }

    pipeline.setShapes(logo.shapes);
    resize();
    await pipeline.prepare();
    if (disposed) {
      return;
    }
    cleanups.push(
      installDrawing({
        canvas,
        horizontalHalfWidth: logo.horizontalHalfWidth,
        verticalHalfWidth: logo.verticalHalfWidth,
        onChange: (strokes) => {
          pipeline.setShapes([...logo.shapes, ...strokes]);
          sceneChanged = true;
          schedule();
        },
        onHover: (point) => {
          pointer = point;
        },
      }),
    );
    const observer = new ResizeObserver(() => {
      needsResize = true;
      schedule();
    });
    observer.observe(canvas);
    cleanups.push(() => observer.disconnect());
    const resume = () => {
      sceneChanged = true;
      schedule();
    };
    document.addEventListener('visibilitychange', resume);
    motion.addEventListener('change', resume);
    cleanups.push(() => document.removeEventListener('visibilitychange', resume));
    cleanups.push(() => motion.removeEventListener('change', resume));
    void gpu.gpu.lost.then(() => fail(new Error('WebGPU device lost')));
    onStatus('ready');
    schedule();
  };

  void initialize().catch(fail);
  return { dispose };
}
