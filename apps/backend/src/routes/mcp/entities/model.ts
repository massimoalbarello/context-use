import { z } from 'zod';
import type { Entity } from '#models/entities/model.ts';
import {
  EntityAddressSchema,
  entityAddress,
  McpReadableIdSchema,
} from '#routes/mcp/coordinates.ts';

export const McpEntitySchema = z.object({
  address: EntityAddressSchema,
  readableId: McpReadableIdSchema,
  name: z.string(),
  description: z.string(),
  isSelf: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export function mcpEntity(entity: Entity) {
  return {
    address: entityAddress(entity.readableId),
    readableId: entity.readableId,
    name: entity.name,
    description: entity.description,
    isSelf: entity.isSelf,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
