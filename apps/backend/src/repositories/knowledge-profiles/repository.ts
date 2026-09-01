import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type { KnowledgeProfile } from '#models/knowledge-profiles/model.ts';
import type { Queries } from '#queries.gen.ts';
import { entityFrom } from '#views/entities/entity-view.ts';

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

type CreatedProfileRow = Queries['CreateKnowledgeProfileEntity'];

function createdProfileFrom(row: CreatedProfileRow): KnowledgeProfile {
  return { selfEntity: { ...row, isSelf: true, image: null } };
}

export class KnowledgeProfilesRepository implements KnowledgeProfilesRepositoryContract {
  private readonly sql: TypedSQL<Queries>;

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

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
      const profiles = await db.FindKnowledgeProfileOwner`
        /* @notNull ownerId */
        select "owner_id" as "ownerId" from "knowledge_profile"
        where "owner_id" = ${input.ownerId}
      `;
      if (profiles[0]) {
        return { state: 'profile_exists' } as const;
      }

      const entities = await db.CreateKnowledgeProfileEntity`
        /* @notNull id readableId name description createdAt updatedAt */
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
      return { state: 'created' as const, profile: createdProfileFrom(entity) };
    });
  }

  async find({ ownerId }: { ownerId: string }): Promise<KnowledgeProfile | null> {
    const rows = await this.sql.FindKnowledgeProfile`
      /* @notNull id readableId name description createdAt updatedAt */
      /* @type isSelf number */
      select entity."id", entity."readable_id" as "readableId", entity."name",
        entity."description", 1 as "isSelf", entity."created_at" as "createdAt",
        entity."updated_at" as "updatedAt", image."id" as "imageId",
        image."readable_id" as "imageReadableId", image."name" as "imageName",
        image."media_type" as "imageMediaType", image."extension" as "imageExtension",
        image."size_bytes" as "imageSizeBytes", image."created_at" as "imageCreatedAt",
        image."updated_at" as "imageUpdatedAt"
      from "knowledge_profile" profile
      join "entity" entity
        on entity."id" = profile."self_entity_id" and entity."owner_id" = profile."owner_id"
      left join "asset" image
        on image."owner_id" = entity."owner_id" and image."id" = entity."image_asset_id"
       and image."archived_at" is null
      where profile."owner_id" = ${ownerId}
    `;
    return rows[0] ? { selfEntity: entityFrom(rows[0]) } : null;
  }
}
