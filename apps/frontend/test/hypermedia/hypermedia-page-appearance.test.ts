import { describe, expect, test } from 'bun:test';
import { hypermediaPageAppearance } from '../../src/components/hypermedia/hypermedia-page-appearance';

const referenceTime = Date.parse('2026-09-03T12:00:00.000Z');
const emphasisFloor = 0.5;

describe('Hypermedia page appearance', () => {
  test('keeps semantic pages fully emphasized', () => {
    expect(hypermediaPageAppearance({ temporalCoverage: null, referenceTime })).toEqual({
      kind: 'semantic',
      emphasis: 1,
    });
  });

  test('fades temporal pages monotonically with distance while preserving a visible floor', () => {
    const current = hypermediaPageAppearance({ temporalCoverage: '2026-09', referenceTime });
    const recent = hypermediaPageAppearance({ temporalCoverage: '2025', referenceTime });
    const older = hypermediaPageAppearance({ temporalCoverage: '2015', referenceTime });
    const distant = hypermediaPageAppearance({ temporalCoverage: '1900', referenceTime });

    expect(current).toEqual({ kind: 'temporal', emphasis: 1 });
    expect(recent.emphasis).toBeGreaterThan(older.emphasis);
    expect(older.emphasis).toBeGreaterThan(distant.emphasis);
    expect(distant.emphasis).toBeGreaterThanOrEqual(emphasisFloor);
  });

  test('treats ongoing coverage as current', () => {
    expect(hypermediaPageAppearance({ temporalCoverage: '2020/..', referenceTime }).emphasis).toBe(
      1,
    );
  });
});
