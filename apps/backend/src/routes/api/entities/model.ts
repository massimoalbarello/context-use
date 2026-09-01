import { t } from 'elysia';
import {
  type Entity,
  MAX_ENTITY_DESCRIPTION_LENGTH,
  MAX_ENTITY_NAME_LENGTH,
  MIN_ENTITY_DESCRIPTION_LENGTH,
} from '#models/entities/model.ts';
import { AssetSummarySchema, assetSummaryResponse } from '#routes/api/assets/summary-model.ts';
import {
  PaginationMetadataSchema,
  PaginationQuerySchema,
  ReadableIdSchema,
} from '#routes/api/model.ts';

export const EntitySchema = t.Object({
  id: t.String({ format: 'uuid' }),
  readableId: ReadableIdSchema,
  name: t.String(),
  description: t.String(),
  isSelf: t.Boolean(),
  image: t.Nullable(AssetSummarySchema),
  createdAt: t.Date(),
  updatedAt: t.Date(),
});

export const EntityReferenceSchema = t.Object({
  id: EntitySchema.properties.id,
  readableId: EntitySchema.properties.readableId,
  name: EntitySchema.properties.name,
  description: EntitySchema.properties.description,
  isSelf: EntitySchema.properties.isSelf,
});

export const EntityIdentityBodySchema = t.Object({
  name: t.String({ minLength: 1, maxLength: MAX_ENTITY_NAME_LENGTH, pattern: '.*\\S.*' }),
  description: t.String({
    minLength: MIN_ENTITY_DESCRIPTION_LENGTH,
    maxLength: MAX_ENTITY_DESCRIPTION_LENGTH,
    pattern: '.*\\S.*',
  }),
});

export const CreateEntityBodySchema = t.Object({
  ...EntityIdentityBodySchema.properties,
  allowDuplicate: t.Optional(t.Boolean()),
});
export const UpdateEntityBodySchema = EntityIdentityBodySchema;
export const SetEntityImageBodySchema = t.Object({ assetReadableId: ReadableIdSchema });
export const EntityParamsSchema = t.Object({ entityReadableId: ReadableIdSchema });
export const EntityListQuerySchema = t.Object({
  ...PaginationQuerySchema.properties,
  query: t.Optional(t.String({ maxLength: MAX_ENTITY_NAME_LENGTH })),
});
export const EntityListSchema = t.Object({
  items: t.Array(EntitySchema),
  ...PaginationMetadataSchema.properties,
});

export function entityResponse(entity: Entity) {
  return {
    ...entity,
    image: entity.image ? assetSummaryResponse(entity.image) : null,
    createdAt: new Date(entity.createdAt),
    updatedAt: new Date(entity.updatedAt),
  };
}

export function entityReferenceResponse(
  entity: Pick<Entity, 'id' | 'readableId' | 'name' | 'description' | 'isSelf'>,
) {
  return entity;
}
