// Adapted from vgpu's Adaptive Quality example (frame-health.ts):
// https://vgpu.sh/examples/adaptive-quality/source.md
// Upstream: vercel-labs/vgpu@96ced572f2ab03f4da93d7db81bf5b75c0827f07
// apps/docs/examples/adaptive-quality/frame-health.ts
// Copyright (c) 2025 Vercel, Inc. MIT license; see the repository LICENSE.
// Uses the upstream default policy; configuration and diagnostic interfaces are narrowed
// to this renderer. Feed every raw animation tick, including ticks skipped while the GPU is busy.

const DEFAULT_REFRESH_FPS = 60;
const MAX_INTERACTIVE_FPS = 90;
const HEALTH_WINDOW_MS = 2000;
const HEALTH_RATIO = 0.8;
const REFRESH_SAMPLE_COUNT = 20;
const MAX_REFRESH_SAMPLES = 60;
const INACTIVE_GAP_MS = 250;
const MILLISECONDS_PER_SECOND = 1000;
const MIN_REFRESH_INTERVAL_MS = 4;
const MAX_REFRESH_INTERVAL_MS = 50;
const MEDIAN = 0.5;
const LOWER_QUANTILE = 0.2;
const UPPER_QUANTILE = 0.8;
const REFRESH_STABILITY_RATIO = 0.12;
const MIN_REFRESH_INCREASE_FPS = 4;
const TARGET_CHANGE_FPS = 0.5;

export type FrameHealthSample = {
  readonly deltaMs: number;
  readonly active: boolean;
  readonly rendered: boolean;
  /** Intentional frame cap, when the renderer uses one. */
  readonly targetFps?: number;
};

type TimedFrame = { durationMs: number; rendered: boolean };

export function createFrameHealthMonitor() {
  let refreshFps = DEFAULT_REFRESH_FPS;
  let refreshSamples: number[] = [];
  let activeFrames: TimedFrame[] = [];
  let activeDurationMs = 0;
  let activeRenderedFrames = 0;
  let activeTargetFps: number | undefined;
  let downgrade = false;

  const resetActiveWindow = () => {
    activeFrames = [];
    activeDurationMs = 0;
    activeRenderedFrames = 0;
    activeTargetFps = undefined;
  };
  const reset = () => {
    refreshFps = DEFAULT_REFRESH_FPS;
    refreshSamples = [];
    downgrade = false;
    resetActiveWindow();
  };
  const targetFor = (sample: FrameHealthSample) =>
    sample.targetFps !== undefined && Number.isFinite(sample.targetFps) && sample.targetFps > 0
      ? Math.min(sample.targetFps, refreshFps)
      : Math.min(refreshFps, MAX_INTERACTIVE_FPS);
  const status = (targetFps: number) => ({
    downgrade,
    estimatedRefreshFps: refreshFps,
    targetFps,
    thresholdFps: targetFps * HEALTH_RATIO,
    observedFps:
      activeDurationMs > 0
        ? activeRenderedFrames / (activeDurationMs / MILLISECONDS_PER_SECOND)
        : undefined,
    activeWindowMs: activeDurationMs,
  });
  const appendFrame = (sample: FrameHealthSample) => {
    activeFrames.push({ durationMs: sample.deltaMs, rendered: sample.rendered });
    activeDurationMs += sample.deltaMs;
    if (sample.rendered) {
      activeRenderedFrames++;
    }
    while (
      activeFrames.length > 1 &&
      activeDurationMs - activeFrames[0]!.durationMs >= HEALTH_WINDOW_MS
    ) {
      const removed = activeFrames.shift()!;
      activeDurationMs -= removed.durationMs;
      if (removed.rendered) {
        activeRenderedFrames--;
      }
    }
  };
  const record = (sample: FrameHealthSample) => {
    if (downgrade) {
      return status(activeTargetFps ?? DEFAULT_REFRESH_FPS);
    }
    if (
      !sample.active ||
      !Number.isFinite(sample.deltaMs) ||
      sample.deltaMs <= 0 ||
      sample.deltaMs > INACTIVE_GAP_MS
    ) {
      resetActiveWindow();
      return status(targetFor(sample));
    }

    const previousRefresh = refreshFps;
    refreshFps = updatedRefreshFps({
      current: refreshFps,
      samples: refreshSamples,
      deltaMs: sample.deltaMs,
    });
    refreshSamples.push(sample.deltaMs);
    if (refreshSamples.length > MAX_REFRESH_SAMPLES) {
      refreshSamples.shift();
    }
    const target = targetFor(sample);
    if (
      activeTargetFps !== undefined &&
      (Math.abs(activeTargetFps - target) > TARGET_CHANGE_FPS ||
        Math.abs(previousRefresh - refreshFps) > TARGET_CHANGE_FPS)
    ) {
      resetActiveWindow();
    }
    activeTargetFps = target;
    appendFrame(sample);
    const observedFps = activeRenderedFrames / (activeDurationMs / MILLISECONDS_PER_SECOND);
    if (activeDurationMs >= HEALTH_WINDOW_MS && observedFps < target * HEALTH_RATIO) {
      downgrade = true;
    }
    return status(target);
  };
  return { record, reset };
}

function updatedRefreshFps({
  current,
  samples,
  deltaMs,
}: {
  current: number;
  samples: readonly number[];
  deltaMs: number;
}) {
  if (deltaMs < MIN_REFRESH_INTERVAL_MS || deltaMs > MAX_REFRESH_INTERVAL_MS) {
    return current;
  }
  const next = [...samples, deltaMs].slice(-REFRESH_SAMPLE_COUNT);
  if (next.length < REFRESH_SAMPLE_COUNT) {
    return current;
  }
  // biome-ignore lint/complexity/useMaxParams: Array.sort supplies two values.
  const sorted = next.sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length * MEDIAN)]!;
  const lower = sorted[Math.floor(sorted.length * LOWER_QUANTILE)]!;
  const upper = sorted[Math.floor(sorted.length * UPPER_QUANTILE)]!;
  // Preserve upstream's 60 FPS floor: slow frames must not lower their own target.
  if ((upper - lower) / median > REFRESH_STABILITY_RATIO) {
    return current;
  }
  const candidate = MILLISECONDS_PER_SECOND / median;
  return candidate > current + MIN_REFRESH_INCREASE_FPS ? candidate : current;
}
