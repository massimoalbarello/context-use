import { t } from 'elysia';
import type { KnowledgeProfile } from '#models/knowledge-profile.ts';
import { EntityBodySchema, EntitySchema, entityResponse } from '#routes/api/entities/model.ts';

export const KnowledgeProfileSchema = t.Object({ selfEntity: EntitySchema });
export const CreateKnowledgeProfileBodySchema = EntityBodySchema;

export function knowledgeProfileResponse(profile: KnowledgeProfile) {
  return { selfEntity: entityResponse(profile.selfEntity) };
}
