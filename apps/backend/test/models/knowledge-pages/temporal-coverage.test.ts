import { describe, expect, test } from 'bun:test';
import {
  InvalidTemporalCoverageError,
  MAX_TEMPORAL_COVERAGE_LENGTH,
  parseTemporalCoverage,
  temporalBoundsFrom,
} from '#models/knowledge-pages/temporal-coverage.ts';

const MAXIMAL_TEMPORAL_COVERAGE = '9999-12-31?/9999-12-31~';

describe('knowledge page temporal coverage', () => {
  test.each([
    '2026',
    '2026-09',
    '2024-02-29',
    '2024?',
    '2024-06~',
    '2025-03/2025-08',
    '2025-03~/2025-08?',
    '2025-11?/..',
    MAXIMAL_TEMPORAL_COVERAGE,
  ])('preserves valid coverage without inventing precision: %s', (coverage) => {
    expect(parseTemporalCoverage(coverage).expression).toBe(coverage);
  });

  test('bounds coverage at the longest supported interval representation', () => {
    expect(MAXIMAL_TEMPORAL_COVERAGE).toHaveLength(MAX_TEMPORAL_COVERAGE_LENGTH);
  });

  test.each([
    '',
    ' 2026',
    '2026-13',
    '2026-02-29',
    '2024%',
    '2024?~',
    '2026-09-01T14:30:00',
    '2026-09-01T14:30:00Z',
    '2026/2025',
    '../2024',
    '../..',
    '2025/',
    '/2025',
    'spring 2026',
  ])('rejects ambiguous or impossible coverage: %s', (coverage) => {
    expect(() => parseTemporalCoverage(coverage)).toThrow(InvalidTemporalCoverageError);
  });
});

test('normalizes calendar precision to closed-open bounds without expanding markers', () => {
  expect(temporalBoundsFrom('2025')).toEqual({
    start: Date.parse('2025-01-01T00:00:00.000Z'),
    end: Date.parse('2026-01-01T00:00:00.000Z'),
  });
  expect(temporalBoundsFrom('2025-03~/2025-08?')).toEqual({
    start: Date.parse('2025-03-01T00:00:00.000Z'),
    end: Date.parse('2025-09-01T00:00:00.000Z'),
  });
  expect(temporalBoundsFrom('2025-11?/..')).toEqual({
    start: Date.parse('2025-11-01T00:00:00.000Z'),
    end: null,
  });
});
