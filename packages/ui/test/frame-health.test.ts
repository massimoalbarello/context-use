import { expect, test } from 'bun:test';
import { createFrameHealthMonitor } from '../src/components/brand/light/frame-health';

const SECOND = 1000;
const DEFAULT_FPS = 60;
const HIGH_REFRESH_FPS = 120;
const EXPECTED_MAX_TARGET_FPS = 90;
const FRAME_CAP_FPS = 30;
const HEALTHY_SECONDS = 3;
const PARTIAL_WINDOW_SECONDS = 1;
const IDLE_GAP_MS = 300;
const SHORT_STALL_MS = 100;

function playback() {
  const health = createFrameHealthMonitor();
  return {
    health,
    run({
      fps = DEFAULT_FPS,
      every = 1,
      seconds = HEALTHY_SECONDS,
      active = true,
      targetFps,
    }: {
      fps?: number;
      every?: number;
      seconds?: number;
      active?: boolean;
      targetFps?: number;
    } = {}) {
      let result!: ReturnType<typeof health.record>;
      for (let index = 0; index < fps * seconds; index++) {
        result = health.record({
          deltaMs: SECOND / fps,
          active,
          rendered: index % every === 0,
          targetFps,
        });
      }
      return result;
    },
  };
}

test.each([DEFAULT_FPS, HIGH_REFRESH_FPS])('healthy %i Hz rendering retains quality', (fps) => {
  const player = playback();
  const status = player.run({ fps });
  expect(status.downgrade).toBe(false);
  expect(status.estimatedRefreshFps).toBeCloseTo(fps);
  expect(status.targetFps).toBeCloseTo(Math.min(fps, EXPECTED_MAX_TARGET_FPS));
});

test('GPU skips on a fast display count as missed frames, not a slower refresh rate', () => {
  const player = playback();
  const status = player.run({ fps: HIGH_REFRESH_FPS, every: 2 });
  expect(status.estimatedRefreshFps).toBeCloseTo(HIGH_REFRESH_FPS);
  expect(status.observedFps).toBeCloseTo(DEFAULT_FPS, 0);
  expect(status.downgrade).toBe(true);
});

test('an intentional 30 FPS cap is judged against its cap', () => {
  const player = playback();
  const status = player.run({ every: 2, targetFps: FRAME_CAP_FPS });
  expect(status.targetFps).toBe(FRAME_CAP_FPS);
  expect(status.observedFps).toBeCloseTo(FRAME_CAP_FPS);
  expect(status.downgrade).toBe(false);
});

test('a target change starts a fresh measurement window', () => {
  const player = playback();
  expect(player.run({ every: 2, seconds: PARTIAL_WINDOW_SECONDS }).downgrade).toBe(false);
  expect(player.run({ every: 2, targetFps: FRAME_CAP_FPS }).downgrade).toBe(false);
});

test('inactive startup and reduced motion do not count as slow rendering', () => {
  const player = playback();
  const inactive = player.run({ active: false });
  expect(inactive.activeWindowMs).toBe(0);
  expect(inactive.downgrade).toBe(false);
  expect(player.run({ every: 2, seconds: PARTIAL_WINDOW_SECONDS }).downgrade).toBe(false);
});

test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, IDLE_GAP_MS])(
  'invalid or idle interval %s clears a partial slow window',
  (deltaMs) => {
    const player = playback();
    player.run({ every: 2, seconds: PARTIAL_WINDOW_SECONDS });
    const interrupted = player.health.record({ deltaMs, active: true, rendered: false });
    expect(interrupted.activeWindowMs).toBe(0);
    expect(interrupted.downgrade).toBe(false);
    expect(player.run({ every: 2, seconds: PARTIAL_WINDOW_SECONDS }).downgrade).toBe(false);
  },
);

test('a hidden tick clears a partial slow window', () => {
  const player = playback();
  player.run({ every: 2, seconds: PARTIAL_WINDOW_SECONDS });
  player.health.record({ deltaMs: SECOND / DEFAULT_FPS, active: false, rendered: false });
  expect(player.run({ every: 2, seconds: PARTIAL_WINDOW_SECONDS }).downgrade).toBe(false);
});

test('one short stall in otherwise healthy rendering does not downgrade', () => {
  const player = playback();
  player.run();
  expect(
    player.health.record({ deltaMs: SHORT_STALL_MS, active: true, rendered: false }).downgrade,
  ).toBe(false);
  expect(player.run().downgrade).toBe(false);
});

test('a downgrade stays latched until reset', () => {
  const player = playback();
  expect(player.run({ every: 2 }).downgrade).toBe(true);
  expect(player.run().downgrade).toBe(true);
  player.health.reset();
  expect(player.run().downgrade).toBe(false);
});

test('slow animation callbacks do not lower the upstream 60 FPS floor', () => {
  const player = playback();
  const status = player.run({ fps: FRAME_CAP_FPS });
  expect(status.estimatedRefreshFps).toBe(DEFAULT_FPS);
  expect(status.downgrade).toBe(true);
});
