import { expect, test } from 'bun:test';
import { createAdaptiveQuality } from '../src/components/brand/light/quality';

const SECOND = 1000;
const DISPLAY_FPS = 60;
const MEASUREMENT_SECONDS = 3;
const PARTIAL_WINDOW_SECONDS = 1;

function playback() {
  const quality = createAdaptiveQuality();
  return {
    quality,
    run({
      every = 1,
      seconds = MEASUREMENT_SECONDS,
      active = true,
    }: {
      every?: number;
      seconds?: number;
      active?: boolean;
    } = {}) {
      let changes = 0;
      for (let tick = 0; tick < DISPLAY_FPS * seconds; tick++) {
        if (
          quality.sample({ deltaMs: SECOND / DISPLAY_FPS, rendered: tick % every === 0, active })
        ) {
          changes++;
        }
      }
      return changes;
    },
  };
}

test('healthy rendering keeps the high profile', () => {
  const player = playback();
  expect(player.run()).toBe(0);
  expect(player.quality.current.name).toBe('high');
});

test('sustained misses step down once per measurement window and stop at low', () => {
  const player = playback();
  expect(player.run({ every: 2 })).toBe(1);
  expect(player.quality.current.name).toBe('medium');
  expect(player.run({ every: 2 })).toBe(1);
  expect(player.quality.current.name).toBe('low');
  expect(player.run({ every: 2 })).toBe(0);
  expect(player.run()).toBe(0);
  expect(player.quality.current.name).toBe('low');
});

test('reset discards partial measurements without restoring a downgraded tier', () => {
  const player = playback();
  player.run({ every: 2 });
  player.quality.reset();
  expect(player.run({ every: 2, seconds: PARTIAL_WINDOW_SECONDS })).toBe(0);
  expect(player.quality.current.name).toBe('medium');
});

test('inactive ticks cannot downgrade quality', () => {
  const player = playback();
  expect(player.run({ every: 2, active: false })).toBe(0);
  expect(player.quality.current.name).toBe('high');
});
