import { describe, expect, test } from 'bun:test';
import {
  InvalidTemporalCoverageError,
  MAX_TEMPORAL_COVERAGE_LENGTH,
  temporalCoverageFrom,
} from '#models/knowledge-pages/temporal-coverage.ts';

const MAXIMAL_TEMPORAL_COVERAGE = '9999-12-31?/9999-12-31~';

describe('knowledge page temporal coverage', () => {
  test.each([
    null,
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
    expect(temporalCoverageFrom(coverage)).toBe(coverage);
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
    expect(() => temporalCoverageFrom(coverage)).toThrow(InvalidTemporalCoverageError);
  });
});
