import { Elysia, StatusMap, t } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { createAuthPlugin } from '#lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#lib/errors.ts';
import { ResourceNameConflictSchema } from '#routes/api/model.ts';
import {
  CreateKnowledgeProfileBodySchema,
  KnowledgeProfileSchema,
  knowledgeProfileResponse,
} from '#routes/api/profile/model.ts';
import type { KnowledgeProfilesServiceContract } from '#services/knowledge-profiles/service.ts';

export function createKnowledgeProfileController({
  auth,
  profilesService,
}: {
  auth: Auth;
  profilesService: KnowledgeProfilesServiceContract;
}) {
  return new Elysia()
    .use(createAuthPlugin({ auth }))
    .guard({
      auth: true,
      response: { [StatusMap.Unauthorized]: ErrorResponseSchema },
    })
    .post(
      '/profile',
      async ({ body, user, status }) => {
        const result = await profilesService.create({ ownerId: user.id, ...body });
        if (result.state === 'created') {
          return status(StatusMap.Created, knowledgeProfileResponse(result.profile));
        }
        if (result.state === 'name_conflict') {
          return status(StatusMap.Conflict, {
            error:
              'An entity with this name already exists. Use a more specific name or keep this name anyway.',
            nameConflict: true as const,
          });
        }
        return status(StatusMap.Conflict, { error: 'The owner entity already exists' });
      },
      {
        detail: { tags: ['Profile'], summary: 'Create the knowledge base owner entity' },
        body: CreateKnowledgeProfileBodySchema,
        response: {
          [StatusMap.Created]: KnowledgeProfileSchema,
          [StatusMap.Conflict]: t.Union([ResourceNameConflictSchema, ErrorResponseSchema]),
        },
      },
    )
    .get(
      '/profile',
      async ({ user, status }) => {
        const profile = await profilesService.find({ ownerId: user.id });
        return profile
          ? status(StatusMap.OK, knowledgeProfileResponse(profile))
          : status(StatusMap['Not Found'], { error: 'Owner entity not found' });
      },
      {
        detail: { tags: ['Profile'], summary: 'Read the knowledge base owner entity' },
        response: {
          [StatusMap.OK]: KnowledgeProfileSchema,
          [StatusMap['Not Found']]: ErrorResponseSchema,
        },
      },
    );
}
