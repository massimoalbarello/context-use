import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import { type Page, pageFrom } from '#lib/pagination.ts';
import type { Entity } from '#models/entities/model.ts';
import type { KnowledgePageReference } from '#models/knowledge-pages/model.ts';
import type { ArchiveResult } from '#models/resource-archiving/model.ts';
import type { Queries } from '#queries.gen.ts';
import { entityFrom } from '#views/entities/entity-view.ts';

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
  setImage(input: {
    ownerId: string;
    readableId: string;
    assetId: string;
    updatedAt: string;
  }): Promise<Entity | null>;
  removeImage(input: {
    ownerId: string;
    readableId: string;
    updatedAt: string;
  }): Promise<Entity | null>;
  archive(input: {
    ownerId: string;
    readableId: string;
    archivedAt: string;
  }): Promise<ArchiveResult<KnowledgePageReference> | { state: 'self_entity' }>;
}

export class EntitiesRepository implements EntityRepositoryContract {
  private readonly sql: TypedSQL<Queries>;

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  async create(input: {
    id: string;
    ownerId: string;
    readableId: string;
    name: string;
    description: string;
    createdAt: string;
  }): Promise<{ state: 'created'; entity: Entity } | { state: 'readable_id_conflict' }> {
    const rows = await this.sql.CreateEntity`
      /* @notNull id readableId name description createdAt updatedAt */
      /* @type isSelf number */
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
      ? {
          state: 'created',
          entity: { ...rows[0], isSelf: Boolean(rows[0].isSelf), image: null },
        }
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
      ? this.sql.SearchEntities`
          /* @notNull id readableId name description createdAt updatedAt */
          /* @type isSelf number */
          select entity."id", entity."readable_id" as "readableId", entity."name",
            entity."description", profile."self_entity_id" is not null as "isSelf",
            entity."created_at" as "createdAt", entity."updated_at" as "updatedAt",
            image."id" as "imageId", image."readable_id" as "imageReadableId",
            image."name" as "imageName", image."media_type" as "imageMediaType",
            image."extension" as "imageExtension", image."size_bytes" as "imageSizeBytes",
            image."created_at" as "imageCreatedAt", image."updated_at" as "imageUpdatedAt"
          from "entity" entity
          left join "knowledge_profile" profile
           on profile."owner_id" = entity."owner_id"
           and profile."self_entity_id" = entity."id"
          left join "entity_image" entity_image
            on entity_image."owner_id" = entity."owner_id"
           and entity_image."entity_id" = entity."id"
          left join "asset" image
            on image."owner_id" = entity_image."owner_id"
           and image."id" = entity_image."asset_id"
           and image."archived_at" is null
          where entity."owner_id" = ${ownerId}
            and entity."archived_at" is null
            and (
              instr(lower(entity."name"), lower(${normalizedQuery})) > 0
              or instr(entity."readable_id", lower(${normalizedQuery})) > 0
            )
          order by entity."name" collate nocase, entity."readable_id"
          limit ${limit} offset ${offset}
        `
      : this.sql.ListEntities`
          /* @notNull id readableId name description createdAt updatedAt */
          /* @type isSelf number */
          select entity."id", entity."readable_id" as "readableId", entity."name",
            entity."description", profile."self_entity_id" is not null as "isSelf",
            entity."created_at" as "createdAt", entity."updated_at" as "updatedAt",
            image."id" as "imageId", image."readable_id" as "imageReadableId",
            image."name" as "imageName", image."media_type" as "imageMediaType",
            image."extension" as "imageExtension", image."size_bytes" as "imageSizeBytes",
            image."created_at" as "imageCreatedAt", image."updated_at" as "imageUpdatedAt"
          from "entity" entity
          left join "knowledge_profile" profile
           on profile."owner_id" = entity."owner_id"
           and profile."self_entity_id" = entity."id"
          left join "entity_image" entity_image
            on entity_image."owner_id" = entity."owner_id"
           and entity_image."entity_id" = entity."id"
          left join "asset" image
            on image."owner_id" = entity_image."owner_id"
           and image."id" = entity_image."asset_id"
           and image."archived_at" is null
          where entity."owner_id" = ${ownerId}
            and entity."archived_at" is null
          order by entity."name" collate nocase, entity."readable_id"
          limit ${limit} offset ${offset}
        `;
    const countsPromise = normalizedQuery
      ? this.sql.CountSearchedEntities`
          /* @notNull total */
          select count(*) as "total" from "entity"
          where "owner_id" = ${ownerId}
            and "archived_at" is null
            and (
              instr(lower("name"), lower(${normalizedQuery})) > 0
              or instr("readable_id", lower(${normalizedQuery})) > 0
            )
        `
      : this.sql.CountEntities`
          /* @notNull total */
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

  find({ ownerId, readableId }: { ownerId: string; readableId: string }): Promise<Entity | null> {
    return this.findWith({ db: this.sql, ownerId, readableId });
  }

  private async findWith({
    db,
    ownerId,
    readableId,
  }: {
    db: TypedSQL<Queries>;
    ownerId: string;
    readableId: string;
  }): Promise<Entity | null> {
    const rows = await db.FindEntity`
      /* @notNull id readableId name description createdAt updatedAt */
      /* @type isSelf number */
      select entity."id", entity."readable_id" as "readableId", entity."name",
        entity."description", profile."self_entity_id" is not null as "isSelf",
        entity."created_at" as "createdAt", entity."updated_at" as "updatedAt",
        image."id" as "imageId", image."readable_id" as "imageReadableId",
        image."name" as "imageName", image."media_type" as "imageMediaType",
        image."extension" as "imageExtension", image."size_bytes" as "imageSizeBytes",
        image."created_at" as "imageCreatedAt", image."updated_at" as "imageUpdatedAt"
      from "entity" entity
      left join "knowledge_profile" profile
        on profile."owner_id" = entity."owner_id" and profile."self_entity_id" = entity."id"
      left join "entity_image" entity_image
        on entity_image."owner_id" = entity."owner_id" and entity_image."entity_id" = entity."id"
      left join "asset" image
        on image."owner_id" = entity_image."owner_id" and image."id" = entity_image."asset_id"
       and image."archived_at" is null
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
    const rows = await this.sql.UpdateEntityIdentity`
      /* @notNull id */
      update "entity"
      set "name" = ${name}, "description" = ${description}, "updated_at" = ${updatedAt}
      where "owner_id" = ${ownerId} and "readable_id" = ${readableId}
        and "archived_at" is null
      returning "id"
    `;
    return rows[0] ? this.find({ ownerId, readableId }) : null;
  }

  setImage({
    ownerId,
    readableId,
    assetId,
    updatedAt,
  }: {
    ownerId: string;
    readableId: string;
    assetId: string;
    updatedAt: string;
  }): Promise<Entity | null> {
    return this.sql.begin(async (db) => {
      const rows = await db.SetEntityImage`
        /* @notNull entityId */
        insert into "entity_image" ("owner_id", "entity_id", "asset_id")
        select entity."owner_id", entity."id", asset."id"
        from "entity" entity
        join "asset" asset on asset."owner_id" = entity."owner_id"
        where entity."owner_id" = ${ownerId} and entity."readable_id" = ${readableId}
          and entity."archived_at" is null and asset."id" = ${assetId}
          and asset."archived_at" is null
        on conflict ("entity_id") do update set
          "owner_id" = excluded."owner_id",
          "asset_id" = excluded."asset_id"
        returning "entity_id" as "entityId"
      `;
      if (!rows[0]) {
        return null;
      }
      await db`
        update "entity" set "updated_at" = ${updatedAt}
        where "owner_id" = ${ownerId} and "id" = ${rows[0].entityId}
      `;
      return this.findWith({ db, ownerId, readableId });
    });
  }

  removeImage({
    ownerId,
    readableId,
    updatedAt,
  }: {
    ownerId: string;
    readableId: string;
    updatedAt: string;
  }): Promise<Entity | null> {
    return this.sql.begin(async (db) => {
      const targets = await db.FindEntityImageRemovalTarget`
        /* @notNull id */
        select "id" from "entity"
        where "owner_id" = ${ownerId} and "readable_id" = ${readableId}
          and "archived_at" is null
      `;
      if (!targets[0]) {
        return null;
      }
      await db`
        delete from "entity_image"
        where "owner_id" = ${ownerId} and "entity_id" = ${targets[0].id}
      `;
      await db`
        update "entity" set "updated_at" = ${updatedAt}
        where "owner_id" = ${ownerId} and "id" = ${targets[0].id}
      `;
      return this.findWith({ db, ownerId, readableId });
    });
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
      const targets = await db.FindEntityArchiveTarget`
        /* @notNull id */
        /* @type isSelf number */
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
    db: TypedSQL<Queries>;
    ownerId: string;
    entityId: string;
  }): Promise<KnowledgePageReference[]> {
    const rows = await db.ListActiveEntityMentioningPages`
      /* @notNull id readableId revisionNumber title excerpt createdAt updatedAt */
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
