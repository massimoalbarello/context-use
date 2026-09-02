import { describe, expect, test } from 'bun:test';
import {
  temporalCoverageLabel,
  temporalCoverageMutation,
  temporalCoverageTitle,
} from '../../src/lib/temporal-coverage';

describe('temporal coverage presentation', () => {
  test.each([
    { expression: '2025', expected: '2025' },
    { expression: '2025-03~', expected: 'March 2025~' },
    { expression: '2025-03-14?', expected: 'March 14, 2025?' },
    { expression: '2025-03/2025-08', expected: 'March 2025 – August 2025' },
    { expression: '2024-11?/..', expected: 'Since November 2024? · ongoing' },
  ])('formats $expression without inventing precision', ({ expression, expected }) => {
    expect(temporalCoverageLabel(expression)).toBe(expected);
  });

  test('keeps the exact expression and marker meaning available', () => {
    expect(temporalCoverageTitle('2025-03~')).toBe(
      'Subject time stored as 2025-03~. ~ means approximate.',
    );
    expect(temporalCoverageTitle('2025?')).toBe('Subject time stored as 2025?. ? means uncertain.');
  });
});

describe('temporal coverage form mutation', () => {
  test('omits unchanged and initially unasserted coverage', () => {
    expect(temporalCoverageMutation({ initial: '2025', current: '2025' })).toBeUndefined();
    expect(temporalCoverageMutation({ initial: null, current: '' })).toBeUndefined();
  });

  test('distinguishes clearing from replacement', () => {
    expect(temporalCoverageMutation({ initial: '2025', current: '' })).toBeNull();
    expect(temporalCoverageMutation({ initial: '2025', current: ' 2026~ ' })).toBe('2026~');
  });
});
