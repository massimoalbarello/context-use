const QUALITY_LEVELS = [
  { name: 'high', effectDimension: 1024, raySamples: 320 },
  { name: 'medium', effectDimension: 768, raySamples: 256 },
  { name: 'low', effectDimension: 384, raySamples: 256 },
] as const;

export type Quality = (typeof QUALITY_LEVELS)[number];

const WARMUP_MS = 1000;
const WINDOW_MS = 2000;
const MINIMUM_FPS = 45;
const SLOW_WINDOWS_BEFORE_DOWNGRADE = 2;
const MILLISECONDS_PER_SECOND = 1000;

// Measure completed frames, including GPU work. Downgrades stick for this renderer's
// lifetime so a device near a tier boundary cannot repeatedly switch quality.
export function createAdaptiveQuality() {
  let level = 0;
  let warmupUntil: number | undefined;
  let windowStart: number | undefined;
  let frames = 0;
  let slowWindows = 0;

  const reset = () => {
    warmupUntil = undefined;
    windowStart = undefined;
    frames = 0;
    slowWindows = 0;
  };

  return {
    get current(): Quality {
      return QUALITY_LEVELS[level]!;
    },
    reset,
    sample(now: number): boolean {
      if (level === QUALITY_LEVELS.length - 1) {
        return false;
      }
      warmupUntil ??= now + WARMUP_MS;
      if (now < warmupUntil) {
        return false;
      }
      if (windowStart === undefined) {
        windowStart = now;
        return false;
      }
      frames++;
      const elapsed = now - windowStart;
      if (elapsed < WINDOW_MS) {
        return false;
      }
      const fps = (frames * MILLISECONDS_PER_SECOND) / elapsed;
      slowWindows = fps < MINIMUM_FPS ? slowWindows + 1 : 0;
      windowStart = now;
      frames = 0;
      if (slowWindows < SLOW_WINDOWS_BEFORE_DOWNGRADE) {
        return false;
      }
      level++;
      reset();
      return true;
    },
  };
}
