import { MAX_ASSET_NAME_LENGTH } from '@repo/backend/asset';
import { DuplicateResourceNameError } from '../../lib/api-error';
import type { CreateAssetVariables } from '../../queries/assets';

const ENTITY_IMAGE_NAME_SUFFIX = ' image';

export function entityImageAssetName(entityName: string): string {
  const nameLength = MAX_ASSET_NAME_LENGTH - ENTITY_IMAGE_NAME_SUFFIX.length;
  return `${entityName.trim().slice(0, nameLength).trimEnd()}${ENTITY_IMAGE_NAME_SUFFIX}`;
}

export async function createEntityImageAsset({
  entityName,
  file,
  createAsset,
}: {
  entityName: string;
  file: File;
  createAsset: (input: CreateAssetVariables) => Promise<{ readableId: string }>;
}): Promise<{ readableId: string }> {
  const input = { name: entityImageAssetName(entityName), file };
  try {
    return await createAsset(input);
  } catch (error) {
    if (!(error instanceof DuplicateResourceNameError)) {
      throw error;
    }
    return createAsset({ ...input, allowDuplicate: true });
  }
}
