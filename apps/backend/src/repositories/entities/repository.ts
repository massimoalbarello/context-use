import type { SQL } from 'bun';
import { type Page, pageFrom } from '#lib/pagination.ts';
import type { Entity } from '#models/entities/model.ts';
import type {
  KnowledgePageReference,
  KnowledgePageSummary,
} from '#models/knowledge-pages/model.ts';
import type { ArchiveResult } from '#models/resource-archiving/model.ts';

export interface EntityRepositoryContract {
  create(input: {
    id: string;
    ownerId: string;
    readableId: string;
    name: string;
    description: string;
    createdAt: string;
  }): Promise<{ state: 'created'; entity: Entity } | { state: 'readable_id_conflict' }>;
  list(input: {
    ownerId: string;
    limit: number;
    offset: number;
    query?: string;
  }): Promise<Page<Entity>>;
  find(input: { ownerId: string; readableId: string }): Promise<Entity | null>;
  update(input: {
    ownerId: string;
    readableId: string;
    name: string;
    description: string;
    updatedAt: string;
  }): Promise<Entity | null>;
  archive(input: {
    ownerId: string;
    readableId: string;
    archivedAt: string;
  }): Promise<ArchiveResult<KnowledgePageReference> | { state: 'self_entity' }>;
}

type EntityRow = {
  id: string;
  readableId: string;
  name: string;
  description: string;
  isSelf: number;
  createdAt: string;
  updatedAt: string;
};

type MentioningPageRow = Omit<KnowledgePageSummary, 'revisionNumber'> & {
  revisionNumber: number;
};

function entityFrom(row: EntityRow): Entity {
  return { ...row, isSelf: Boolean(row.isSelf) };
}

export class EntitiesRepository implements EntityRepositoryContract {
  private readonly sql: SQL;

  constructor(sql: SQL) {
    this.sql = sql;
  }

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
            and entity."archived_at" is null
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
            and entity."archived_at" is null
          order by entity."name" collate nocase, entity."readable_id"
          limit ${limit} offset ${offset}
        `;
    const countsPromise = normalizedQuery
      ? this.sql<Array<{ total: number }>>`
          select count(*) as "total" from "entity"
          where "owner_id" = ${ownerId}
            and "archived_at" is null
            and (
              instr(lower("name"), lower(${normalizedQuery})) > 0
              or instr("readable_id", lower(${normalizedQuery})) > 0
            )
        `
      : this.sql<Array<{ total: number }>>`
          select count(*) as "total" from "entity"
          where "owner_id" = ${ownerId} and "archived_at" is null
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
        and entity."archived_at" is null
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
        and "archived_at" is null
      returning "id", "readable_id" as "readableId", "name", "description",
        exists(
          select 1 from "knowledge_profile"
          where "owner_id" = ${ownerId} and "self_entity_id" = "entity"."id"
        ) as "isSelf", "created_at" as "createdAt", "updated_at" as "updatedAt"
    `;
    return rows[0] ? entityFrom(rows[0]) : null;
  }

  archive({
    ownerId,
    readableId,
    archivedAt,
  }: {
    ownerId: string;
    readableId: string;
    archivedAt: string;
  }): Promise<ArchiveResult<KnowledgePageReference> | { state: 'self_entity' }> {
    return this.sql.begin(async (db) => {
      const targets = await db<Array<{ id: string; isSelf: number; archivedAt: string | null }>>`
        select entity."id", entity."archived_at" as "archivedAt", exists(
          select 1 from "knowledge_profile"
          where "owner_id" = ${ownerId} and "self_entity_id" = entity."id"
        ) as "isSelf"
        from "entity" entity
        where "owner_id" = ${ownerId} and "readable_id" = ${readableId}
      `;
      const target = targets[0];
      if (!target) {
        return { state: 'not_found' } as const;
      }
      if (target.isSelf) {
        return { state: 'self_entity' } as const;
      }
      if (target.archivedAt) {
        return { state: 'archived' } as const;
      }
      const blockers = await this.listActiveMentioningPages({
        db,
        ownerId,
        entityId: target.id,
      });
      if (blockers.length > 0) {
        return { state: 'resource_in_use' as const, blockers };
      }
      await db`
        update "entity"
        set "archived_at" = ${archivedAt}
        where "owner_id" = ${ownerId} and "id" = ${target.id}
      `;
      return { state: 'archived' } as const;
    });
  }

  private async listActiveMentioningPages({
    db,
    ownerId,
    entityId,
  }: {
    db: SQL;
    ownerId: string;
    entityId: string;
  }): Promise<KnowledgePageReference[]> {
    const rows = await db<MentioningPageRow[]>`
      select referring_page."id", referring_page."readable_id" as "readableId",
        current_referring_revision."revision_number" as "revisionNumber",
        current_referring_revision."title", current_referring_revision."excerpt",
        referring_page."created_at" as "createdAt", referring_page."updated_at" as "updatedAt"
      from "knowledge_page_entity_mention" inbound_mention
      join "knowledge_page_revision" current_referring_revision
        on current_referring_revision."id" = inbound_mention."source_revision_id"
       and current_referring_revision."owner_id" = inbound_mention."owner_id"
      join "knowledge_page" referring_page
        on referring_page."id" = current_referring_revision."page_id"
       and referring_page."owner_id" = inbound_mention."owner_id"
       and referring_page."current_revision_id" = current_referring_revision."id"
       and referring_page."archived_at" is null
      where inbound_mention."owner_id" = ${ownerId}
        and inbound_mention."target_entity_id" = ${entityId}
      order by current_referring_revision."title", referring_page."readable_id"
    `;
    return rows.map((page) => ({
      page: { ...page, revisionNumber: Number(page.revisionNumber) },
      fragment: null,
    }));
  }
}
