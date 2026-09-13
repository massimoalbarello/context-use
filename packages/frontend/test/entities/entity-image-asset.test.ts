import { describe, expect, test } from 'bun:test';
import { MAX_ASSET_NAME_LENGTH } from '@repo/backend/asset';
import {
  createEntityImageAsset,
  entityImageAssetName,
} from '../../src/components/entities/entity-image-asset';
import { DuplicateResourceNameError } from '../../src/lib/api-error';

const file = new File(['image'], 'portrait.png', { type: 'image/png' });

describe('entity image asset creation', () => {
  test('derives a bounded asset name from the entity', () => {
    expect(entityImageAssetName('  Maya Chen  ')).toBe('Maya Chen image');
    expect(entityImageAssetName('a'.repeat(MAX_ASSET_NAME_LENGTH))).toHaveLength(
      MAX_ASSET_NAME_LENGTH,
    );
  });

  test('automatically uses the standard duplicate suffix path after a name conflict', async () => {
    const inputs: Array<{ name: string; file: File; allowDuplicate?: boolean }> = [];
    const result = await createEntityImageAsset({
      entityName: 'Maya Chen',
      file,
      createAsset: (input) => {
        inputs.push(input);
        if (!input.allowDuplicate) {
          return Promise.reject(new DuplicateResourceNameError('Name conflict'));
        }
        return Promise.resolve({ readableId: 'maya-chen-image-a1b2c3' });
      },
    });

    expect(result).toEqual({ readableId: 'maya-chen-image-a1b2c3' });
    expect(inputs).toEqual([
      { name: 'Maya Chen image', file },
      { name: 'Maya Chen image', file, allowDuplicate: true },
    ]);
  });

  test('does not retry unrelated failures', async () => {
    let attempts = 0;
    const error = new Error('Upload failed');
    const creation = createEntityImageAsset({
      entityName: 'Maya Chen',
      file,
      createAsset: () => {
        attempts += 1;
        return Promise.reject(error);
      },
    });

    await expect(creation).rejects.toBe(error);
    expect(attempts).toBe(1);
  });
});
