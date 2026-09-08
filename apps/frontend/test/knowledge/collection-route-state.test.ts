import { expect, test } from 'bun:test';
import { MAX_ASSET_NAME_LENGTH } from '@repo/backend/asset';
import { MAX_ENTITY_NAME_LENGTH } from '@repo/backend/entity';
import { assetsQueryOptions } from '../../src/queries/assets';
import { entitiesQueryOptions } from '../../src/queries/entities';
import { assetSearch } from '../../src/routes/assets';
import { entitySearch } from '../../src/routes/entities';

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
  expect(entitiesQueryOptions('maya').queryKey).not.toEqual(entitiesQueryOptions().queryKey);
  expect(assetsQueryOptions('rollout').queryKey).not.toEqual(assetsQueryOptions().queryKey);
});
