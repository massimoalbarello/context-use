import { z } from 'zod';
import {
  ENTITY_TYPE_DESCRIPTION,
  ENTITY_TYPE_FILTERS,
  ENTITY_TYPES,
  type Entity,
  type EntityReference,
} from '#backend/models/entities/model.ts';
import { entityAddress } from '#backend/models/readable-ids/addresses.ts';
import { EntityAddressSchema, McpReadableIdSchema } from '#backend/routes/mcp/coordinates.ts';
import { McpPublicationSchema, mcpPublication } from '#backend/routes/mcp/publications/model.ts';

export const McpEntityTypeSchema = z
  .enum(ENTITY_TYPES)
  .nullable()
  .describe(ENTITY_TYPE_DESCRIPTION);
export const McpEntityTypeFilterSchema = z
  .enum(ENTITY_TYPE_FILTERS)
  .describe(
    'Filter entities by their assigned type. Untyped selects entities with no assigned type; all includes typed and untyped entities. Keep this filter unchanged when continuing a list cursor.',
  );

export const McpEntityReferenceSchema = z.object({
  address: EntityAddressSchema,
  publication: McpPublicationSchema,
  readableId: McpReadableIdSchema,
  name: z.string(),
  description: z.string(),
  entityType: McpEntityTypeSchema,
  isSelf: z.boolean(),
});

export const McpEntitySchema = McpEntityReferenceSchema.extend({
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export function mcpEntityReference(entity: EntityReference) {
  return {
    address: entityAddress(entity.readableId),
    readableId: entity.readableId,
    publication: mcpPublication(entity),
    name: entity.name,
    description: entity.description,
    entityType: entity.entityType,
    isSelf: entity.isSelf,
  };
}

export function mcpEntity(entity: Entity) {
  return {
    ...mcpEntityReference(entity),
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
