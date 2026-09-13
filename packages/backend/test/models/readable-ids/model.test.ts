import { describe, expect, test } from 'bun:test';
import {
  MAX_READABLE_ID_LENGTH,
  readableIdFrom,
  readableIdWithSuffix,
} from '#models/readable-ids/model.ts';

describe('readableIdFrom', () => {
  test('derives stable ASCII words from a display name or page title', () => {
    expect(readableIdFrom('  Àda’s Focus: Retrieval & Revision  ')).toBe(
      'adas-focus-retrieval-revision',
    );
  });

  test('derives a deterministic address when no ASCII words are available', () => {
    expect(readableIdFrom('東京')).toBe('u-6771-4eac');
  });

  test('caps IDs without leaving a trailing separator', () => {
    const readableId = readableIdFrom(`${'a'.repeat(MAX_READABLE_ID_LENGTH - 1)} long`);
    expect(readableId).toHaveLength(MAX_READABLE_ID_LENGTH - 1);
    expect(readableId.endsWith('-')).toBe(false);
  });

  test('makes room for a bounded collision suffix', () => {
    const readableId = readableIdWithSuffix({
      readableId: 'a'.repeat(MAX_READABLE_ID_LENGTH),
      suffix: 'a1b2c3',
    });
    expect(readableId).toHaveLength(MAX_READABLE_ID_LENGTH);
    expect(readableId.endsWith('-a1b2c3')).toBe(true);
  });
});
