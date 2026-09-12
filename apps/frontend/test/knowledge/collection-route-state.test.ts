import { expect, test } from 'bun:test';
import { MAX_ASSET_NAME_LENGTH } from '@repo/backend/asset';
import { ENTITY_TYPE_FILTERS, MAX_ENTITY_NAME_LENGTH } from '@repo/backend/entity';
import { entitySearch } from '../../src/lib/entity-filters';
import { assetsQueryOptions } from '../../src/queries/assets';
import { entitiesQueryOptions } from '../../src/queries/entities';
import { assetSearch } from '../../src/routes/assets';

test('entity and asset keyword searches are canonical URL state', () => {
  expect(entitySearch({ q: '  Maya  ' })).toEqual({ q: 'Maya' });
  expect(assetSearch({ q: '  rollout  ' })).toEqual({ q: 'rollout' });
  expect(entitySearch({ q: '  ' })).toEqual({});
  expect(assetSearch({ q: 42 })).toEqual({});
  expect(entitySearch({ q: 'e'.repeat(MAX_ENTITY_NAME_LENGTH + 1) }).q).toHaveLength(
    MAX_ENTITY_NAME_LENGTH,
  );
  expect(assetSearch({ q: 'a'.repeat(MAX_ASSET_NAME_LENGTH + 1) }).q).toHaveLength(
    MAX_ASSET_NAME_LENGTH,
  );
});

test('filtered collection pages use distinct query caches', () => {
  expect(entitiesQueryOptions({ query: 'maya' }).queryKey).not.toEqual(
    entitiesQueryOptions().queryKey,
  );
  expect(assetsQueryOptions('rollout').queryKey).not.toEqual(assetsQueryOptions().queryKey);
});

test('entity type URL state rejects invented types and separates every filtered cache', () => {
  expect(entitySearch({ q: ' Maya ', entityType: 'person' })).toEqual({
    q: 'Maya',
    entityType: 'person',
  });
  expect(entitySearch({ entityType: 'untyped' }).entityType).toBe('untyped');
  expect(entitySearch({ entityType: 'all' }).entityType).toBeUndefined();
  expect(entitySearch({ entityType: 'event' }).entityType).toBeUndefined();
  expect(entitySearch({ entityType: ['person', 'location'] }).entityType).toBeUndefined();
  const keys = ENTITY_TYPE_FILTERS.map((entityType) =>
    JSON.stringify(
      entitiesQueryOptions({ query: 'maya', entityType: entitySearch({ entityType }).entityType })
        .queryKey,
    ),
  );
  expect(new Set(keys).size).toBe(ENTITY_TYPE_FILTERS.length);
});
