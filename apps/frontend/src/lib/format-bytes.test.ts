import { describe, expect, test } from 'bun:test';
import { formatBytes } from './format-bytes';

const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;

describe('formatBytes', () => {
  test('formats bytes without a fractional part', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1)).toBe('1 B');
  });

  test('uses binary thresholds and one fractional digit for larger units', () => {
    expect(formatBytes(BYTES_PER_KILOBYTE)).toBe('1.0 kB');
    expect(formatBytes(BYTES_PER_KILOBYTE + BYTES_PER_KILOBYTE / 2)).toBe('1.5 kB');
    expect(formatBytes(BYTES_PER_MEGABYTE)).toBe('1.0 MB');
  });
});
