import { t } from 'elysia';
import type { KnowledgeProfile } from '#models/knowledge-profiles/model.ts';
import {
  CreateEntityBodySchema,
  EntitySchema,
  entityResponse,
} from '#routes/api/entities/model.ts';

export const KnowledgeProfileSchema = t.Object({ selfEntity: EntitySchema });
export const CreateKnowledgeProfileBodySchema = CreateEntityBodySchema;

export function knowledgeProfileResponse(profile: KnowledgeProfile) {
  return { selfEntity: entityResponse(profile.selfEntity) };
}
