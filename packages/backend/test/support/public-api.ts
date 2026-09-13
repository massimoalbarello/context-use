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
  for (const child of Object.values(value)) {
    expectNoInternalResourceIds(child);
  }
}
