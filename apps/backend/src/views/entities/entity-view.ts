import type { Entity } from '#models/entities/model.ts';
import type { Queries } from '#queries.gen.ts';

export type EntityRow = Queries['FindEntity'];

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
