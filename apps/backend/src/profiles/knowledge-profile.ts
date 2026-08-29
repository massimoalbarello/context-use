import type { Entity } from '#entities/entity.ts';

export interface KnowledgeProfile {
  selfEntity: Entity;
}

export interface KnowledgeProfilesRepositoryContract {
  create(input: {
    ownerId: string;
    entityId: string;
    readableId: string;
    name: string;
    description: string;
    createdAt: string;
  }): Promise<
    | { state: 'created'; profile: KnowledgeProfile }
    | { state: 'profile_exists' }
    | { state: 'readable_id_conflict' }
  >;
  find(input: { ownerId: string }): Promise<KnowledgeProfile | null>;
}
