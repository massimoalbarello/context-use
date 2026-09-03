import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { EMBEDDABLE_ASSET_MEDIA_TYPES } from '#models/assets/media.ts';
import type { EntityDetail } from '#models/entities/model.ts';
import {
  MAX_ENTITY_DESCRIPTION_LENGTH,
  MAX_ENTITY_NAME_LENGTH,
  MIN_ENTITY_DESCRIPTION_LENGTH,
} from '#models/entities/model.ts';
import type { McpClientAuthorizationPrincipal } from '#models/mcp-client-authorizations/model.ts';
import {
  AssetAddressSchema,
  assetReadableId,
  EntityAddressSchema,
  entityAddress,
  entityReadableId,
} from '#routes/mcp/coordinates.ts';
import { McpEntitySchema, mcpEntity } from '#routes/mcp/entities/model.ts';
import {
  McpKnowledgePageSummarySchema,
  mcpArchiveBlockers,
  mcpKnowledgePageSummary,
} from '#routes/mcp/pages/model.ts';
import {
  DEFAULT_MCP_LIST_LIMIT,
  decodeMcpCursor,
  encodeMcpCursor,
  McpListInputSchema,
} from '#routes/mcp/pagination.ts';
import {
  MCP_ARCHIVE_TOOL_ANNOTATIONS,
  MCP_READ_TOOL_ANNOTATIONS,
  MCP_WRITE_TOOL_ANNOTATIONS,
} from '#routes/mcp/tool-annotations.ts';
import { mcpToolError, mcpToolSuccess } from '#routes/mcp/tool-result.ts';
import type { EntitiesServiceContract } from '#services/entities/service.ts';
import type { KnowledgeProfilesServiceContract } from '#services/knowledge-profiles/service.ts';

const ENTITY_IMAGE_MEDIA_TYPES = EMBEDDABLE_ASSET_MEDIA_TYPES.join(', ');
const ENTITY_IMAGE_UPDATE_DESCRIPTION = `For imageAssetAddress, omit it to preserve the current image; send null to clear it; or provide a value referencing an existing asset with a supported media type (${ENTITY_IMAGE_MEDIA_TYPES}) to replace it.`;

const CreateEntityInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(MAX_ENTITY_NAME_LENGTH)
    .regex(/.*\S.*/),
  description: z
    .string()
    .min(MIN_ENTITY_DESCRIPTION_LENGTH)
    .max(MAX_ENTITY_DESCRIPTION_LENGTH)
    .regex(/.*\S.*/),
  allowDuplicate: z
    .boolean()
    .optional()
    .describe('Retry with true only after a name-conflict result and a deliberate decision'),
  isSelf: z
    .boolean()
    .optional()
    .describe(
      'Set true only during initial setup to create the knowledge base owner entity. This can succeed only once.',
    ),
  imageAssetAddress: AssetAddressSchema.optional().describe(
    `Existing asset with a supported media type (${ENTITY_IMAGE_MEDIA_TYPES}) to assign as the entity image. Omit when no image should be assigned.`,
  ),
});

const EntityAddressInputSchema = z.object({ address: EntityAddressSchema });

const UpdateEntityInputSchema = EntityAddressInputSchema.extend({
  name: CreateEntityInputSchema.shape.name,
  description: CreateEntityInputSchema.shape.description,
  imageAssetAddress: AssetAddressSchema.nullable()
    .optional()
    .describe(ENTITY_IMAGE_UPDATE_DESCRIPTION),
});

const EntityListOutputSchema = z.object({
  items: z.array(McpEntitySchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
});

const CreateEntityOutputSchema = z.object({ address: EntityAddressSchema });

const UpdateEntityOutputSchema = z.object({});

const ArchiveEntityOutputSchema = z.object({
  archived: z.literal(true),
  address: EntityAddressSchema,
});

const McpEntityDetailSchema = McpEntitySchema.extend({
  pages: z.array(McpKnowledgePageSummarySchema),
});

function mcpEntityDetail(entity: EntityDetail) {
  return {
    ...mcpEntity(entity),
    pages: entity.pages.map(mcpKnowledgePageSummary),
  };
}

function entityImageError({
  state,
  createdEntityAddress,
}: {
  state: 'not_found' | 'invalid_asset_type' | 'image_in_use';
  createdEntityAddress?: string;
}) {
  const details = createdEntityAddress ? { createdEntityAddress } : undefined;
  if (state === 'invalid_asset_type') {
    return mcpToolError({
      code: 'invalid_asset_type',
      message: `Entity image assets must use a supported media type: ${ENTITY_IMAGE_MEDIA_TYPES}.`,
      details,
    });
  }
  if (state === 'image_in_use') {
    return mcpToolError({
      code: 'image_in_use',
      message: 'This image asset is already assigned to another entity.',
      details,
    });
  }
  return mcpToolError({
    code: 'not_found',
    message: 'Entity or image asset not found.',
    details,
  });
}

export function registerEntityTools({
  server,
  principal,
  entitiesService,
  profilesService,
}: {
  server: McpServer;
  principal: McpClientAuthorizationPrincipal;
  entitiesService: EntitiesServiceContract;
  profilesService: KnowledgeProfilesServiceContract;
}): void {
  server.registerTool(
    'create_entity',
    {
      title: 'Create entity',
      description:
        'Create one entity identity, optionally assigning an existing image asset. Set isSelf true only to create the knowledge base owner entity during initial setup; that role can be created only once. If the derived address already exists, returns an explicit conflict that may be retried with allowDuplicate.',
      inputSchema: CreateEntityInputSchema,
      outputSchema: CreateEntityOutputSchema,
      annotations: MCP_WRITE_TOOL_ANNOTATIONS,
    },
    async ({ isSelf, imageAssetAddress, ...input }) => {
      let readableId: string;
      if (isSelf) {
        const result = await profilesService.create({ ownerId: principal.ownerId, ...input });
        if (result.state === 'profile_exists') {
          return mcpToolError({
            code: 'self_entity_exists',
            message: 'The knowledge base owner entity already exists.',
          });
        }
        if (result.state === 'name_conflict') {
          return mcpToolError({
            code: 'entity_name_conflict',
            message:
              'An entity with this name already exists. Use a more specific name, or retry with allowDuplicate only after deciding the duplicate is intentional.',
            details: { allowDuplicateRetryAvailable: true },
          });
        }
        readableId = result.profile.selfEntity.readableId;
      } else {
        const result = await entitiesService.create({ ownerId: principal.ownerId, ...input });
        if (result.state === 'name_conflict') {
          return mcpToolError({
            code: 'entity_name_conflict',
            message:
              'An entity with this name already exists. Use a more specific name, or retry with allowDuplicate only after deciding the duplicate is intentional.',
            details: { allowDuplicateRetryAvailable: true },
          });
        }
        readableId = result.entity.readableId;
      }

      const address = entityAddress(readableId);
      if (imageAssetAddress) {
        const imageResult = await entitiesService.setImage({
          ownerId: principal.ownerId,
          readableId,
          assetReadableId: assetReadableId(imageAssetAddress),
        });
        if (imageResult.state !== 'updated') {
          return entityImageError({ state: imageResult.state, createdEntityAddress: address });
        }
      }
      return mcpToolSuccess({ address });
    },
  );

  server.registerTool(
    'list_entities',
    {
      title: 'List entities',
      description:
        'List active entities without searching. Pass nextCursor unchanged to continue the list.',
      inputSchema: McpListInputSchema,
      outputSchema: EntityListOutputSchema,
      annotations: MCP_READ_TOOL_ANNOTATIONS,
    },
    async ({ cursor, limit = DEFAULT_MCP_LIST_LIMIT }) => {
      const decoded = decodeMcpCursor({ cursor, list: 'entities' });
      if (decoded.state === 'invalid') {
        return mcpToolError({
          code: 'invalid_cursor',
          message: 'The entity-list cursor is invalid. Restart the list without a cursor.',
        });
      }
      const page = await entitiesService.list({
        ownerId: principal.ownerId,
        limit,
        offset: decoded.offset,
      });
      return mcpToolSuccess({
        items: page.items.map(mcpEntity),
        total: page.total,
        nextCursor: encodeMcpCursor({ list: 'entities', offset: page.nextOffset }),
      });
    },
  );

  server.registerTool(
    'read_entity',
    {
      title: 'Read entity',
      description: 'Read one active entity by its exact canonical entity address.',
      inputSchema: EntityAddressInputSchema,
      outputSchema: McpEntityDetailSchema,
      annotations: MCP_READ_TOOL_ANNOTATIONS,
    },
    async ({ address }) => {
      const entity = await entitiesService.detail({
        ownerId: principal.ownerId,
        readableId: entityReadableId(address),
      });
      return entity
        ? mcpToolSuccess(mcpEntityDetail(entity))
        : mcpToolError({ code: 'not_found', message: 'Entity not found.' });
    },
  );

  server.registerTool(
    'update_entity',
    {
      title: 'Update entity',
      description: `Update the name, description, and optionally the image of one active entity at its exact address. ${ENTITY_IMAGE_UPDATE_DESCRIPTION}`,
      inputSchema: UpdateEntityInputSchema,
      outputSchema: UpdateEntityOutputSchema,
      annotations: MCP_WRITE_TOOL_ANNOTATIONS,
    },
    async ({ address, name, description, imageAssetAddress }) => {
      const readableId = entityReadableId(address);
      if (imageAssetAddress === null) {
        const entity = await entitiesService.removeImage({
          ownerId: principal.ownerId,
          readableId,
        });
        if (!entity) {
          return mcpToolError({ code: 'not_found', message: 'Entity not found.' });
        }
      } else if (imageAssetAddress !== undefined) {
        const result = await entitiesService.setImage({
          ownerId: principal.ownerId,
          readableId,
          assetReadableId: assetReadableId(imageAssetAddress),
        });
        if (result.state !== 'updated') {
          return entityImageError({ state: result.state });
        }
      }
      const entity = await entitiesService.update({
        ownerId: principal.ownerId,
        readableId,
        name,
        description,
      });
      return entity
        ? mcpToolSuccess({})
        : mcpToolError({ code: 'not_found', message: 'Entity not found.' });
    },
  );

  server.registerTool(
    'archive_entity',
    {
      title: 'Archive entity',
      description:
        'Archive one entity. This is destructive and succeeds only when existing domain rules allow it.',
      inputSchema: EntityAddressInputSchema,
      outputSchema: ArchiveEntityOutputSchema,
      annotations: MCP_ARCHIVE_TOOL_ANNOTATIONS,
    },
    async ({ address }) => {
      const result = await entitiesService.archive({
        ownerId: principal.ownerId,
        readableId: entityReadableId(address),
      });
      if (result.state === 'not_found') {
        return mcpToolError({ code: 'not_found', message: 'Entity not found.' });
      }
      if (result.state === 'self_entity') {
        return mcpToolError({
          code: 'archive_not_allowed',
          message: 'This entity cannot be archived.',
        });
      }
      if (result.state === 'resource_in_use') {
        return mcpToolError({
          code: 'resource_in_use',
          message:
            'Archiving is blocked by active pages. Surface these blockers to the user; do not edit or archive them without a new user-informed decision.',
          details: { blockers: mcpArchiveBlockers(result.blockers) },
        });
      }
      return mcpToolSuccess({ archived: true, address: entityAddress(entityReadableId(address)) });
    },
  );
}
