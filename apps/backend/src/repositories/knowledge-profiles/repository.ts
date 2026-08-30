import type { Entity } from '#models/entity.ts';
import type { KnowledgeProfile } from '#models/knowledge-profile.ts';
import { Repository } from '#repositories/repository.ts';

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

type ProfileRow = Omit<Entity, 'isSelf'>;

function profileFrom(row: ProfileRow): KnowledgeProfile {
  return { selfEntity: { ...row, isSelf: true } };
}

export class KnowledgeProfilesRepository
  extends Repository
  implements KnowledgeProfilesRepositoryContract
{
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
  > {
    return this.sql.begin(async (db) => {
      const profiles = await db<Array<{ ownerId: string }>>`
        select "owner_id" as "ownerId" from "knowledge_profile"
        where "owner_id" = ${input.ownerId}
      `;
      if (profiles[0]) {
        return { state: 'profile_exists' } as const;
      }

      const entities = await db<ProfileRow[]>`
        insert into "entity"
          ("id", "owner_id", "readable_id", "name", "description", "created_at", "updated_at")
        values
          (${input.entityId}, ${input.ownerId}, ${input.readableId}, ${input.name},
           ${input.description}, ${input.createdAt}, ${input.createdAt})
        on conflict ("owner_id", "readable_id") do nothing
        returning "id", "readable_id" as "readableId", "name", "description",
          "created_at" as "createdAt", "updated_at" as "updatedAt"
      `;
      const entity = entities[0];
      if (!entity) {
        return { state: 'readable_id_conflict' } as const;
      }

      await db`
        insert into "knowledge_profile" ("owner_id", "self_entity_id")
        values (${input.ownerId}, ${entity.id})
      `;
      return { state: 'created' as const, profile: profileFrom(entity) };
    });
  }

  async find({ ownerId }: { ownerId: string }): Promise<KnowledgeProfile | null> {
    const rows = await this.sql<ProfileRow[]>`
      select entity."id", entity."readable_id" as "readableId", entity."name",
        entity."description", entity."created_at" as "createdAt",
        entity."updated_at" as "updatedAt"
      from "knowledge_profile" profile
      join "entity" entity
        on entity."id" = profile."self_entity_id" and entity."owner_id" = profile."owner_id"
      where profile."owner_id" = ${ownerId}
    `;
    return rows[0] ? profileFrom(rows[0]) : null;
  }
}
