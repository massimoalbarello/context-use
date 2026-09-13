import { describe, expect, test } from 'bun:test';
import { entityInitial } from '../../src/components/entities/entity-link';

describe('entity identity mark', () => {
  test('uses the first visible character of the entity name', () => {
    expect(entityInitial('  massimo albarello')).toBe('M');
    expect(entityInitial('Élodie')).toBe('É');
  });

  test('keeps an empty name recognizable while editing', () => {
    expect(entityInitial('   ')).toBe('?');
  });
});
