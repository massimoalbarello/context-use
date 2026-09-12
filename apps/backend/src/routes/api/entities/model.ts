import { t } from 'elysia';
import {
  ENTITY_TYPE_DESCRIPTION,
  ENTITY_TYPE_FILTERS,
  ENTITY_TYPES,
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

export const EntityTypeSchema = t.UnionEnum(ENTITY_TYPES, {
  description: ENTITY_TYPE_DESCRIPTION,
  default: undefined,
});
export const EntityTypeFilterSchema = t.UnionEnum(ENTITY_TYPE_FILTERS, { default: undefined });

export const EntitySchema = t.Object({
  readableId: ReadableIdSchema,
  name: t.String(),
  description: t.String(),
  entityType: t.Nullable(EntityTypeSchema),
  isSelf: t.Boolean(),
  image: t.Nullable(AssetSummarySchema),
  createdAt: t.Date(),
  updatedAt: t.Date(),
});

export const EntityReferenceSchema = t.Object({
  readableId: EntitySchema.properties.readableId,
  name: EntitySchema.properties.name,
  description: EntitySchema.properties.description,
  entityType: EntitySchema.properties.entityType,
  isSelf: EntitySchema.properties.isSelf,
});

export const EntityIdentityBodySchema = t.Object({
  entityType: t.Optional(
    t.Nullable(EntityTypeSchema, {
      description:
        'Omit to preserve an existing type; null clears it. The self entity always remains a Person.',
    }),
  ),
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
  entityType: t.Optional(EntityTypeFilterSchema),
  ...PaginationQuerySchema.properties,
});
export const EntityListSchema = t.Object({
  items: t.Array(EntitySchema),
  ...PaginationMetadataSchema.properties,
});

export function entityResponse(entity: Entity) {
  return {
    readableId: entity.readableId,
    name: entity.name,
    description: entity.description,
    entityType: entity.entityType,
    isSelf: entity.isSelf,
    image: entity.image ? assetSummaryResponse(entity.image) : null,
    createdAt: new Date(entity.createdAt),
    updatedAt: new Date(entity.updatedAt),
  };
}

export function entityReferenceResponse(
  entity: Pick<Entity, 'readableId' | 'name' | 'description' | 'entityType' | 'isSelf'>,
) {
  return {
    readableId: entity.readableId,
    name: entity.name,
    description: entity.description,
    entityType: entity.entityType,
    isSelf: entity.isSelf,
  };
}
