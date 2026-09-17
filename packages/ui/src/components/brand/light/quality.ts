import { createFrameHealthMonitor, type FrameHealthSample } from './frame-health';

const QUALITY_LEVELS = [
  { name: 'high', effectDimension: 1024, rayDimension: 1536, raySamples: 320 },
  { name: 'medium', effectDimension: 768, rayDimension: 1024, raySamples: 256 },
  { name: 'low', effectDimension: 384, rayDimension: 512, raySamples: 256 },
] as const;

export type Quality = (typeof QUALITY_LEVELS)[number];

// Keep downgrades for this renderer's lifetime to avoid oscillating between tiers.
export function createAdaptiveQuality() {
  let level = 0;
  const health = createFrameHealthMonitor();

  return {
    get current(): Quality {
      return QUALITY_LEVELS[level]!;
    },
    reset: health.reset,
    sample(sample: FrameHealthSample): boolean {
      if (level === QUALITY_LEVELS.length - 1) {
        return false;
      }
      if (!health.record(sample).downgrade) {
        return false;
      }
      level++;
      health.reset();
      return true;
    },
  };
}
