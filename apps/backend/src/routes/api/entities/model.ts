import { t } from 'elysia';
import {
  type Entity,
  MAX_ENTITY_DESCRIPTION_LENGTH,
  MAX_ENTITY_NAME_LENGTH,
  MIN_ENTITY_DESCRIPTION_LENGTH,
} from '#models/entity.ts';
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
  createdAt: t.Date(),
  updatedAt: t.Date(),
});

export const EntityBodySchema = t.Object({
  readableId: t.Optional(ReadableIdSchema),
  name: t.String({ minLength: 1, maxLength: MAX_ENTITY_NAME_LENGTH, pattern: '.*\\S.*' }),
  description: t.String({
    minLength: MIN_ENTITY_DESCRIPTION_LENGTH,
    maxLength: MAX_ENTITY_DESCRIPTION_LENGTH,
    pattern: '.*\\S.*',
  }),
});

export const UpdateEntityBodySchema = t.Omit(EntityBodySchema, ['readableId']);
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
    createdAt: new Date(entity.createdAt),
    updatedAt: new Date(entity.updatedAt),
  };
}
