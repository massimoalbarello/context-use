import { Elysia, StatusMap, t } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { createAuthPlugin } from '#lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#lib/errors.ts';
import type { EntityDetail } from '#models/entities/model.ts';
import {
  EntityParamsSchema,
  EntitySchema,
  entityResponse,
  UpdateEntityBodySchema,
} from '#routes/api/entities/model.ts';
import { KnowledgePageSummarySchema, pageSummaryResponse } from '#routes/api/pages/model.ts';
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
      async ({ params, user, status }) => {
        const entity = await entitiesService.detail({
          ownerId: user.id,
          readableId: params.entityReadableId,
        });
        return entity
          ? status(StatusMap.OK, entityDetailResponse(entity))
          : status(StatusMap['Not Found'], { error: 'Entity not found' });
      },
      {
        detail: { tags: ['Entities'], summary: 'Read an entity and its knowledge pages' },
        params: EntityParamsSchema,
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
    );
}
