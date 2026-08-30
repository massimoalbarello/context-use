import { describe, expect, test } from 'bun:test';
import { MAX_READABLE_ID_LENGTH, readableIdFrom } from '#models/readable-ids/model.ts';

describe('readableIdFrom', () => {
  test('derives stable ASCII words from a display name or page title', () => {
    expect(readableIdFrom('  Àda’s Focus: Retrieval & Revision  ')).toBe(
      'adas-focus-retrieval-revision',
    );
  });

  test('returns null when no readable words can be derived', () => {
    expect(readableIdFrom('東京')).toBeNull();
  });

  test('caps IDs without leaving a trailing separator', () => {
    const readableId = readableIdFrom(`${'a'.repeat(MAX_READABLE_ID_LENGTH - 1)} long`);
    expect(readableId).toHaveLength(MAX_READABLE_ID_LENGTH - 1);
    expect(readableId?.endsWith('-')).toBe(false);
  });
});
