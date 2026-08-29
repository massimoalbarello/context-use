import type { Entity, EntityRepositoryContract } from '#entities/entity.ts';
import { Repository } from '#repositories/repository.ts';

type EntityRow = {
  id: string;
  readableId: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

function entityFrom(row: EntityRow): Entity {
  return row;
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
        "created_at" as "createdAt", "updated_at" as "updatedAt"
    `;
    return rows[0]
      ? { state: 'created', entity: entityFrom(rows[0]) }
      : { state: 'readable_id_conflict' };
  }

  async list({ ownerId }: { ownerId: string }): Promise<Entity[]> {
    const rows = await this.sql<EntityRow[]>`
      select "id", "readable_id" as "readableId", "name", "description",
        "created_at" as "createdAt", "updated_at" as "updatedAt"
      from "entity"
      where "owner_id" = ${ownerId}
      order by "name" collate nocase, "readable_id"
    `;
    return rows.map(entityFrom);
  }

  async find({
    ownerId,
    readableId,
  }: {
    ownerId: string;
    readableId: string;
  }): Promise<Entity | null> {
    const rows = await this.sql<EntityRow[]>`
      select "id", "readable_id" as "readableId", "name", "description",
        "created_at" as "createdAt", "updated_at" as "updatedAt"
      from "entity"
      where "owner_id" = ${ownerId} and "readable_id" = ${readableId}
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
        "created_at" as "createdAt", "updated_at" as "updatedAt"
    `;
    return rows[0] ? entityFrom(rows[0]) : null;
  }
}
