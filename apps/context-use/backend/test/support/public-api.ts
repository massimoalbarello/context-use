import { expect } from 'bun:test';

export function expectNoInternalResourceIds(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      expectNoInternalResourceIds(item);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }

  expect(Object.keys(value)).not.toContain('id');
  for (const [field, child] of Object.entries(value)) {
    if (
      field === 'source' &&
      child &&
      typeof child === 'object' &&
      'provider' in child &&
      'kind' in child
    ) {
      // A record's source ID is an upstream coordinate, not a private database ID.
      const { id, ...source } = child;
      expect(typeof id).toBe('string');
      expectNoInternalResourceIds(source);
    } else {
      expectNoInternalResourceIds(child);
    }
  }
}
