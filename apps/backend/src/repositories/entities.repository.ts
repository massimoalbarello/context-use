import type { Entity, EntityRepositoryContract } from '#entities/entity.ts';
import { pageFrom } from '#pagination/page.ts';
import { Repository } from '#repositories/repository.ts';

type EntityRow = {
  id: string;
  readableId: string;
  name: string;
  description: string;
  isSelf: number;
  createdAt: string;
  updatedAt: string;
};

function entityFrom(row: EntityRow): Entity {
  return { ...row, isSelf: Boolean(row.isSelf) };
}

export class EntitiesRepository extends Repository implements EntityRepositoryContract {
  async create(input: {
    id: string;
    ownerId: string;
    readableId: string;
    name: string;
    description: string;
    createdAt: string;
  }): Promise<{ state: 'created'; entity: Entity } | { state: 'readable_id_conflict' }> {
    const rows = await this.sql<EntityRow[]>`
      insert into "entity"
        ("id", "owner_id", "readable_id", "name", "description", "created_at", "updated_at")
      values
         (${input.id}, ${input.ownerId}, ${input.readableId}, ${input.name}, ${input.description},
         ${input.createdAt}, ${input.createdAt})
      on conflict ("owner_id", "readable_id") do nothing
      returning "id", "readable_id" as "readableId", "name", "description",
        0 as "isSelf", "created_at" as "createdAt", "updated_at" as "updatedAt"
    `;
    return rows[0]
      ? { state: 'created', entity: entityFrom(rows[0]) }
      : { state: 'readable_id_conflict' };
  }

  async list({
    ownerId,
    limit,
    offset,
    query,
  }: {
    ownerId: string;
    limit: number;
    offset: number;
    query?: string;
  }) {
    const normalizedQuery = query?.trim() || null;
    const rowsPromise = normalizedQuery
      ? this.sql<EntityRow[]>`
          select entity."id", entity."readable_id" as "readableId", entity."name",
            entity."description", profile."self_entity_id" is not null as "isSelf",
            entity."created_at" as "createdAt", entity."updated_at" as "updatedAt"
          from "entity" entity
          left join "knowledge_profile" profile
            on profile."owner_id" = entity."owner_id"
           and profile."self_entity_id" = entity."id"
          where entity."owner_id" = ${ownerId}
            and (
              instr(lower(entity."name"), lower(${normalizedQuery})) > 0
              or instr(entity."readable_id", lower(${normalizedQuery})) > 0
            )
          order by entity."name" collate nocase, entity."readable_id"
          limit ${limit} offset ${offset}
        `
      : this.sql<EntityRow[]>`
          select entity."id", entity."readable_id" as "readableId", entity."name",
            entity."description", profile."self_entity_id" is not null as "isSelf",
            entity."created_at" as "createdAt", entity."updated_at" as "updatedAt"
          from "entity" entity
          left join "knowledge_profile" profile
            on profile."owner_id" = entity."owner_id"
           and profile."self_entity_id" = entity."id"
          where entity."owner_id" = ${ownerId}
          order by entity."name" collate nocase, entity."readable_id"
          limit ${limit} offset ${offset}
        `;
    const countsPromise = normalizedQuery
      ? this.sql<Array<{ total: number }>>`
          select count(*) as "total" from "entity"
          where "owner_id" = ${ownerId}
            and (
              instr(lower("name"), lower(${normalizedQuery})) > 0
              or instr("readable_id", lower(${normalizedQuery})) > 0
            )
        `
      : this.sql<Array<{ total: number }>>`
          select count(*) as "total" from "entity" where "owner_id" = ${ownerId}
        `;
    const [rows, counts] = await Promise.all([rowsPromise, countsPromise]);
    return pageFrom({
      items: rows.map(entityFrom),
      total: Number(counts[0]?.total ?? 0),
      offset,
    });
  }

  async find({
    ownerId,
    readableId,
  }: {
    ownerId: string;
    readableId: string;
  }): Promise<Entity | null> {
    const rows = await this.sql<EntityRow[]>`
      select entity."id", entity."readable_id" as "readableId", entity."name",
        entity."description", profile."self_entity_id" is not null as "isSelf",
        entity."created_at" as "createdAt", entity."updated_at" as "updatedAt"
      from "entity" entity
      left join "knowledge_profile" profile
        on profile."owner_id" = entity."owner_id" and profile."self_entity_id" = entity."id"
      where entity."owner_id" = ${ownerId} and entity."readable_id" = ${readableId}
    `;
    return rows[0] ? entityFrom(rows[0]) : null;
  }

  async update({
    ownerId,
    readableId,
    name,
    description,
    updatedAt,
  }: {
    ownerId: string;
    readableId: string;
    name: string;
    description: string;
    updatedAt: string;
  }): Promise<Entity | null> {
    const rows = await this.sql<EntityRow[]>`
      update "entity"
      set "name" = ${name}, "description" = ${description}, "updated_at" = ${updatedAt}
      where "owner_id" = ${ownerId} and "readable_id" = ${readableId}
      returning "id", "readable_id" as "readableId", "name", "description",
        exists(
          select 1 from "knowledge_profile"
          where "owner_id" = ${ownerId} and "self_entity_id" = "entity"."id"
        ) as "isSelf", "created_at" as "createdAt", "updated_at" as "updatedAt"
    `;
    return rows[0] ? entityFrom(rows[0]) : null;
  }
}
