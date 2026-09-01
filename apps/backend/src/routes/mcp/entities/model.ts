import { z } from 'zod';
import type { Entity, EntityReference } from '#models/entities/model.ts';
import {
  EntityAddressSchema,
  entityAddress,
  McpReadableIdSchema,
} from '#routes/mcp/coordinates.ts';

export const McpEntityReferenceSchema = z.object({
  address: EntityAddressSchema,
  readableId: McpReadableIdSchema,
  name: z.string(),
  description: z.string(),
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
    name: entity.name,
    description: entity.description,
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
