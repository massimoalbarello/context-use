import { ENTITY_TYPES, type Entity, type EntityType } from '#models/entities/model.ts';
import type { Queries } from '#queries.gen.ts';

export type EntityRow = Queries['FindEntity'];

export function entityTypeFrom(value: string | null): EntityType | null {
  if (value === null) {
    return null;
  }
  const entityType = ENTITY_TYPES.find((type) => type === value);
  if (!entityType) {
    throw new Error('Invalid persisted entity type');
  }
  return entityType;
}

export function entityFrom(row: EntityRow): Entity {
  const {
    imageId,
    imageReadableId,
    imageName,
    imageMediaType,
    imageExtension,
    imageSizeBytes,
    imageCreatedAt,
    imageUpdatedAt,
    ...entity
  } = row;
  return {
    ...entity,
    entityType: entityTypeFrom(entity.entityType),
    isSelf: Boolean(entity.isSelf),
    image:
      imageId &&
      imageReadableId &&
      imageName &&
      imageMediaType &&
      imageSizeBytes !== null &&
      imageCreatedAt &&
      imageUpdatedAt
        ? {
            id: imageId,
            readableId: imageReadableId,
            name: imageName,
            mediaType: imageMediaType,
            extension: imageExtension,
            sizeBytes: Number(imageSizeBytes),
            createdAt: imageCreatedAt,
            updatedAt: imageUpdatedAt,
          }
        : null,
  };
}
