import { expect, test } from 'bun:test';
import { createAdaptiveQuality } from '../src/components/brand/light/quality';

const SECOND = 1000;
const HEALTHY_FPS = 60;
const SLOW_FPS = 20;
const SETTLING_SECONDS = 6;
const BRIEF_STALL_MS = 250;
const LONG_PAUSE_MS = 60_000;

function playback() {
  const quality = createAdaptiveQuality();
  let now = 0;
  quality.sample(now);
  return {
    quality,
    run({ fps, seconds }: { fps: number; seconds: number }) {
      for (let frame = 0; frame < fps * seconds; frame++) {
        now += SECOND / fps;
        quality.sample(now);
      }
    },
    pause(duration: number) {
      now += duration;
    },
  };
}

test('keeps high quality through healthy rendering and an isolated stall', () => {
  const player = playback();
  player.run({ fps: HEALTHY_FPS, seconds: SETTLING_SECONDS });
  player.pause(BRIEF_STALL_MS);
  player.run({ fps: HEALTHY_FPS, seconds: SETTLING_SECONDS });
  expect(player.quality.current.name).toBe('high');
});

test('sustained slow completed frames step down to medium and then low', () => {
  const player = playback();
  player.run({ fps: SLOW_FPS, seconds: SETTLING_SECONDS });
  expect(player.quality.current.name).toBe('medium');
  player.run({ fps: SLOW_FPS, seconds: SETTLING_SECONDS });
  expect(player.quality.current.name).toBe('low');
  player.run({ fps: SLOW_FPS, seconds: SETTLING_SECONDS });
  expect(player.quality.current.name).toBe('low');
  player.run({ fps: HEALTHY_FPS, seconds: SETTLING_SECONDS });
  expect(player.quality.current.name).toBe('low');
});

test('does not downgrade during startup or a single slow measurement window', () => {
  const player = playback();
  const ONE_SLOW_WINDOW_SECONDS = 3;
  player.run({ fps: SLOW_FPS, seconds: ONE_SLOW_WINDOW_SECONDS });
  expect(player.quality.current.name).toBe('high');
  player.run({ fps: HEALTHY_FPS, seconds: SETTLING_SECONDS });
  expect(player.quality.current.name).toBe('high');
});

test('reset excludes hidden time and resize work without restoring a downgraded tier', () => {
  const player = playback();
  player.run({ fps: SLOW_FPS, seconds: SETTLING_SECONDS });
  expect(player.quality.current.name).toBe('medium');
  player.quality.reset();
  player.pause(LONG_PAUSE_MS);
  player.run({ fps: HEALTHY_FPS, seconds: SETTLING_SECONDS });
  expect(player.quality.current.name).toBe('medium');
});

test('reset discards an incomplete slow sequence', () => {
  const player = playback();
  const ONE_SLOW_WINDOW_SECONDS = 3;
  player.run({ fps: SLOW_FPS, seconds: ONE_SLOW_WINDOW_SECONDS });
  player.quality.reset();
  player.pause(LONG_PAUSE_MS);
  player.run({ fps: SLOW_FPS, seconds: ONE_SLOW_WINDOW_SECONDS });
  expect(player.quality.current.name).toBe('high');
});
