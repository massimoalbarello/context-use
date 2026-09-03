import { Elysia, StatusMap, t } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { createAuthPlugin } from '#lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#lib/errors.ts';
import type { EntityDetail } from '#models/entities/model.ts';
import {
  EntityParamsSchema,
  EntitySchema,
  entityResponse,
  SetEntityImageBodySchema,
  UpdateEntityBodySchema,
} from '#routes/api/entities/model.ts';
import { PreviewRelationshipsQuerySchema } from '#routes/api/model.ts';
import { KnowledgePageSummarySchema, pageSummaryResponse } from '#routes/api/pages/model.ts';
import {
  ResourceInUseResponseSchema,
  resourceInUseResponse,
} from '#routes/api/resource-archiving/model.ts';
import type { EntitiesServiceContract } from '#services/entities/service.ts';

const EntityDetailSchema = t.Object({
  ...EntitySchema.properties,
  pages: t.Array(KnowledgePageSummarySchema),
});

function entityDetailResponse(entity: EntityDetail) {
  return { ...entityResponse(entity), pages: entity.pages.map(pageSummaryResponse) };
}

export function createEntityReadableIdController({
  auth,
  entitiesService,
}: {
  auth: Auth;
  entitiesService: EntitiesServiceContract;
}) {
  return new Elysia()
    .use(createAuthPlugin({ auth }))
    .guard({
      auth: true,
      response: { [StatusMap.Unauthorized]: ErrorResponseSchema },
    })
    .get(
      '/entities/:entityReadableId',
      async ({ params, query, user, status }) => {
        const entity = await entitiesService.detail({
          ownerId: user.id,
          readableId: params.entityReadableId,
          pageLimit: query.relationshipLimit,
        });
        return entity
          ? status(StatusMap.OK, entityDetailResponse(entity))
          : status(StatusMap['Not Found'], { error: 'Entity not found' });
      },
      {
        detail: { tags: ['Entities'], summary: 'Read an entity and its knowledge pages' },
        params: EntityParamsSchema,
        query: PreviewRelationshipsQuerySchema,
        response: {
          [StatusMap.OK]: EntityDetailSchema,
          [StatusMap['Not Found']]: ErrorResponseSchema,
        },
      },
    )
    .patch(
      '/entities/:entityReadableId',
      async ({ body, params, user, status }) => {
        const entity = await entitiesService.update({
          ownerId: user.id,
          readableId: params.entityReadableId,
          ...body,
        });
        return entity
          ? status(StatusMap.OK, entityResponse(entity))
          : status(StatusMap['Not Found'], { error: 'Entity not found' });
      },
      {
        detail: { tags: ['Entities'], summary: 'Update an entity identity' },
        params: EntityParamsSchema,
        body: UpdateEntityBodySchema,
        response: {
          [StatusMap.OK]: EntitySchema,
          [StatusMap['Not Found']]: ErrorResponseSchema,
        },
      },
    )
    .put(
      '/entities/:entityReadableId/image',
      async ({ body, params, user, status }) => {
        const result = await entitiesService.setImage({
          ownerId: user.id,
          readableId: params.entityReadableId,
          assetReadableId: body.assetReadableId,
        });
        if (result.state === 'not_found') {
          return status(StatusMap['Not Found'], { error: 'Entity or asset not found' });
        }
        if (result.state === 'invalid_asset_type') {
          return status(StatusMap['Bad Request'], {
            error: 'Entity images must be PNG, JPEG, GIF, or WebP assets',
          });
        }
        if (result.state === 'image_in_use') {
          return status(StatusMap.Conflict, {
            error: 'This image asset is already assigned to another entity',
          });
        }
        return status(StatusMap.OK, entityResponse(result.entity));
      },
      {
        detail: { tags: ['Entities'], summary: 'Assign an image asset to an entity' },
        params: EntityParamsSchema,
        body: SetEntityImageBodySchema,
        response: {
          [StatusMap.OK]: EntitySchema,
          [StatusMap['Bad Request']]: ErrorResponseSchema,
          [StatusMap.Conflict]: ErrorResponseSchema,
          [StatusMap['Not Found']]: ErrorResponseSchema,
        },
      },
    )
    .delete(
      '/entities/:entityReadableId/image',
      async ({ params, user, status }) => {
        const entity = await entitiesService.removeImage({
          ownerId: user.id,
          readableId: params.entityReadableId,
        });
        return entity
          ? status(StatusMap.OK, entityResponse(entity))
          : status(StatusMap['Not Found'], { error: 'Entity not found' });
      },
      {
        detail: { tags: ['Entities'], summary: 'Remove an entity image' },
        params: EntityParamsSchema,
        response: {
          [StatusMap.OK]: EntitySchema,
          [StatusMap['Not Found']]: ErrorResponseSchema,
        },
      },
    )
    .put(
      '/entities/:entityReadableId/archive',
      async ({ params, user, status }) => {
        const result = await entitiesService.archive({
          ownerId: user.id,
          readableId: params.entityReadableId,
        });
        if (result.state === 'not_found') {
          return status(StatusMap['Not Found'], { error: 'Entity not found' });
        }
        if (result.state === 'self_entity') {
          return status(StatusMap.Conflict, { error: "Your own entity can't be archived" });
        }
        if (result.state === 'resource_in_use') {
          return status(StatusMap.Conflict, resourceInUseResponse(result.blockers));
        }
        return status(StatusMap['No Content'], undefined);
      },
      {
        detail: { tags: ['Entities'], summary: 'Archive an entity' },
        params: EntityParamsSchema,
        response: {
          [StatusMap['No Content']]: t.Void(),
          [StatusMap['Not Found']]: ErrorResponseSchema,
          [StatusMap.Conflict]: t.Union([ErrorResponseSchema, ResourceInUseResponseSchema]),
        },
      },
    );
}
