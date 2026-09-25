import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import { type Page, pageFrom } from '#backend/lib/pagination.ts';
import {
  type Entity,
  type EntityType,
  type EntityTypeFilter,
  SELF_ENTITY_TYPE,
} from '#backend/models/entities/model.ts';
import { type ChangeContext, changedText } from '#backend/models/history/model.ts';
import type { KnowledgePageReference } from '#backend/models/knowledge-pages/model.ts';
import type { PublicationVisibility } from '#backend/models/publications/model.ts';
import type { ArchiveResult } from '#backend/models/resource-archiving/model.ts';
import type { Queries } from '#backend/queries.gen.ts';
import { entityFrom, entityTypeFrom } from '#backend/views/entities/entity-view.ts';
import { retireInvalidPortraitReference } from '../faces/portrait-links.ts';
import { recordChange } from '../record-change.ts';
import { replaceSearchDocument } from '../search-index.ts';

export type SetEntityImageResult =
  | { state: 'updated'; entity: Entity }
  | { state: 'not_found' }
  | { state: 'image_in_use' }
  | { state: 'image_not_public' };

export interface EntityRepositoryContract {
  create(input: {
    id: string;
    ownerId: string;
    readableId: string;
    name: string;
    description: string;
    entityType?: EntityType | null;
    createdAt: string;
    change: ChangeContext;
  }): Promise<{ state: 'created'; entity: Entity } | { state: 'readable_id_conflict' }>;
  list(input: {
    ownerId: string;
    limit: number;
    offset: number;
    visibility?: PublicationVisibility;
    entityType?: EntityTypeFilter;
  }): Promise<Page<Entity>>;
  find(input: { ownerId: string; readableId: string }): Promise<Entity | null>;
  update(input: {
    ownerId: string;
    readableId: string;
    name: string;
    description: string;
    entityType?: EntityType | null;
    updatedAt: string;
    change: ChangeContext;
  }): Promise<Entity | null>;
  setImage(input: {
    ownerId: string;
    readableId: string;
    assetId: string;
    updatedAt: string;
    change: ChangeContext;
  }): Promise<SetEntityImageResult>;
  removeImage(input: {
    ownerId: string;
    readableId: string;
    updatedAt: string;
    change: ChangeContext;
  }): Promise<Entity | null>;
  archive(input: {
    ownerId: string;
    readableId: string;
    archivedAt: string;
    change: ChangeContext;
  }): Promise<ArchiveResult<KnowledgePageReference> | { state: 'self_entity' }>;
}

export class EntitiesRepository implements EntityRepositoryContract {
  private readonly sql: TypedSQL<Queries>;

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  create(input: {
    id: string;
    ownerId: string;
    readableId: string;
    name: string;
    description: string;
    entityType?: EntityType | null;
    createdAt: string;
    change: ChangeContext;
  }): Promise<{ state: 'created'; entity: Entity } | { state: 'readable_id_conflict' }> {
    return this.sql.begin(async (db) => {
      const rows = await db.CreateEntity`
        /* @notNull id readableId name description createdAt updatedAt */
        /* @type isSelf number */
        insert into "entity"
          ("id", "owner_id", "readable_id", "name", "description", "entity_type", "created_at", "updated_at")
        values
           (${input.id}, ${input.ownerId}, ${input.readableId}, ${input.name}, ${input.description}, ${input.entityType ?? null},
           ${input.createdAt}, ${input.createdAt})
        on conflict ("owner_id", "readable_id") do nothing
        returning "id", "readable_id" as "readableId", "name", "description", "entity_type" as "entityType",
          0 as "isSelf", "created_at" as "createdAt", "updated_at" as "updatedAt"
      `;
      const entity = rows[0];
      if (!entity) {
        return { state: 'readable_id_conflict' } as const;
      }
      await replaceSearchDocument({
        db,
        ownerId: input.ownerId,
        resourceType: 'entity',
        readableId: input.readableId,
        label: input.name,
        summary: input.description,
      });
      await recordChange({
        db,
        ownerId: input.ownerId,
        change: input.change,
        resourceType: 'entity',
        readableId: input.readableId,
        name: input.name,
        action: 'created',
        details: [input.description],
        createdAt: input.createdAt,
      });
      return {
        state: 'created' as const,
        entity: {
          ...entity,
          entityType: entityTypeFrom(entity.entityType),
          isSelf: Boolean(entity.isSelf),
          image: null,
        },
      };
    });
  }

  async list({
    ownerId,
    limit,
    offset,
    visibility = 'all',
    entityType = 'all',
  }: {
    ownerId: string;
    limit: number;
    offset: number;
    visibility?: PublicationVisibility;
    entityType?: EntityTypeFilter;
  }) {
    const rowsPromise = this.sql.ListEntities`
      /* @notNull id readableId name description createdAt updatedAt */
      /* @type isSelf number */
      select entity."id", entity."readable_id" as "readableId", entity."name",
        entity."description", entity."entity_type" as "entityType", profile."self_entity_id" is not null as "isSelf",
        entity."created_at" as "createdAt", entity."updated_at" as "updatedAt",
        image."id" as "imageId", image."readable_id" as "imageReadableId",
        image."name" as "imageName", image."media_type" as "imageMediaType",
        image."extension" as "imageExtension", image."size_bytes" as "imageSizeBytes",
        image."created_at" as "imageCreatedAt", image."updated_at" as "imageUpdatedAt"
      from "entity" entity
      left join "knowledge_profile" profile
       on profile."owner_id" = entity."owner_id"
       and profile."self_entity_id" = entity."id"
      left join "asset" image
        on image."owner_id" = entity."owner_id"
       and image."id" = entity."image_asset_id"
       and image."archived_at" is null
      where entity."owner_id" = ${ownerId}
        and entity."archived_at" is null
        and (${visibility} = 'all' or (${visibility} = 'public') = (entity."published_at" is not null))
        and (${entityType} = 'all' or entity."entity_type" = ${entityType}
          or (${entityType} = 'untyped' and entity."entity_type" is null))
      order by entity."name" collate nocase, entity."readable_id"
      limit ${limit} offset ${offset}
    `;
    const countsPromise = this.sql.CountEntities`
      /* @notNull total */
      select count(*) as "total" from "entity"
      where "owner_id" = ${ownerId} and "archived_at" is null
        and (${visibility} = 'all' or (${visibility} = 'public') = (entity."published_at" is not null))
        and (${entityType} = 'all' or "entity_type" = ${entityType}
          or (${entityType} = 'untyped' and "entity_type" is null))
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
        entity."description", entity."entity_type" as "entityType", profile."self_entity_id" is not null as "isSelf",
        entity."created_at" as "createdAt", entity."updated_at" as "updatedAt",
        image."id" as "imageId", image."readable_id" as "imageReadableId",
        image."name" as "imageName", image."media_type" as "imageMediaType",
        image."extension" as "imageExtension", image."size_bytes" as "imageSizeBytes",
        image."created_at" as "imageCreatedAt", image."updated_at" as "imageUpdatedAt"
      from "entity" entity
      left join "knowledge_profile" profile
        on profile."owner_id" = entity."owner_id" and profile."self_entity_id" = entity."id"
      left join "asset" image
        on image."owner_id" = entity."owner_id" and image."id" = entity."image_asset_id"
       and image."archived_at" is null
      where entity."owner_id" = ${ownerId} and entity."readable_id" = ${readableId}
        and entity."archived_at" is null
    `;
    return rows[0] ? entityFrom(rows[0]) : null;
  }

  update({
    ownerId,
    readableId,
    name,
    description,
    entityType,
    updatedAt,
    change,
  }: {
    ownerId: string;
    readableId: string;
    name: string;
    description: string;
    entityType?: EntityType | null;
    updatedAt: string;
    change: ChangeContext;
  }): Promise<Entity | null> {
    return this.sql.begin(async (db) => {
      const previous = await this.findWith({ db, ownerId, readableId });
      const rows = await db.UpdateEntityIdentity`
        /* @notNull id */
        update "entity"
        set "name" = ${name}, "description" = ${description}, "updated_at" = ${updatedAt},
          "entity_type" = case
            when exists (
              select 1 from "knowledge_profile" profile
              where profile."owner_id" = "entity"."owner_id" and profile."self_entity_id" = "entity"."id"
            ) then ${SELF_ENTITY_TYPE}
            when ${entityType === undefined} then "entity_type"
            else ${entityType ?? null}
          end
        where "owner_id" = ${ownerId} and "readable_id" = ${readableId}
          and "archived_at" is null
        returning "id"
      `;
      if (!rows[0]) {
        return null;
      }
      if (entityType !== undefined) {
        await retireInvalidPortraitReference({ db, ownerId, entityId: rows[0].id });
      }
      await replaceSearchDocument({
        db,
        ownerId,
        resourceType: 'entity',
        readableId,
        label: name,
        summary: description,
      });
      const entity = await this.findWith({ db, ownerId, readableId });
      if (entity && previous) {
        const details = [
          ...changedText({ label: 'Name', before: previous.name, after: entity.name }),
          ...changedText({
            label: 'Description',
            before: previous.description,
            after: entity.description,
          }),
          ...changedText({ label: 'Type', before: previous.entityType, after: entity.entityType }),
        ];
        if (details.length) {
          await recordChange({
            db,
            ownerId,
            change,
            resourceType: 'entity',
            readableId,
            name: entity.name,
            action: 'updated',
            details,
            createdAt: updatedAt,
          });
        }
      }
      return entity;
    });
  }

  setImage({
    ownerId,
    readableId,
    assetId,
    updatedAt,
    change,
  }: {
    ownerId: string;
    readableId: string;
    assetId: string;
    updatedAt: string;
    change: ChangeContext;
  }): Promise<SetEntityImageResult> {
    return this.sql.begin('immediate', async (db) => {
      const targets = await db.FindEntityImagePublicationTarget`
        /* @type entityIsPublic number */
        /* @type assetIsPublic number */
        select (entity."published_at" is not null) as "entityIsPublic", (asset."published_at" is not null) as "assetIsPublic"
        from "entity" entity
        join "asset" asset on asset."owner_id" = entity."owner_id" and asset."id" = ${assetId}
        where entity."owner_id" = ${ownerId} and entity."readable_id" = ${readableId}
          and entity."archived_at" is null and asset."archived_at" is null
      `;
      const target = targets[0];
      if (!target) {
        return { state: 'not_found' } as const;
      }
      if (target.entityIsPublic && !target.assetIsPublic) {
        return { state: 'image_not_public' } as const;
      }
      const previous = await this.findWith({ db, ownerId, readableId });
      const rows = await db.SetEntityImage`
        /* @notNull entityId */
        update "entity" as entity
        set "image_asset_id" = ${assetId}, "updated_at" = ${updatedAt}
        where entity."owner_id" = ${ownerId} and entity."readable_id" = ${readableId}
          and entity."archived_at" is null
          and exists (
            select 1 from "asset"
            where "owner_id" = entity."owner_id" and "id" = ${assetId}
              and "archived_at" is null
          )
          and not exists (
            select 1 from "entity" assignment
            where assignment."owner_id" = entity."owner_id"
              and assignment."image_asset_id" = ${assetId}
              and assignment."id" <> entity."id"
          )
        returning "id" as "entityId"
      `;
      if (!rows[0]) {
        return { state: 'image_in_use' } as const;
      }
      await retireInvalidPortraitReference({ db, ownerId, entityId: rows[0].entityId });
      const entity = await this.findWith({ db, ownerId, readableId });
      if (entity && previous?.image?.readableId !== entity.image?.readableId) {
        await recordChange({
          db,
          ownerId,
          change,
          resourceType: 'entity',
          readableId,
          name: entity.name,
          action: 'updated',
          details: changedText({
            label: 'Image',
            before: previous?.image?.name ?? null,
            after: entity.image?.name ?? null,
          }),
          createdAt: updatedAt,
        });
      }
      return entity ? { state: 'updated' as const, entity } : { state: 'not_found' as const };
    });
  }

  removeImage({
    ownerId,
    readableId,
    updatedAt,
    change,
  }: {
    ownerId: string;
    readableId: string;
    updatedAt: string;
    change: ChangeContext;
  }): Promise<Entity | null> {
    return this.sql.begin(async (db) => {
      const previous = await this.findWith({ db, ownerId, readableId });
      const targets = await db.RemoveEntityImage`
        /* @notNull id */
        update "entity"
        set "image_asset_id" = null, "updated_at" = ${updatedAt}
        where "owner_id" = ${ownerId} and "readable_id" = ${readableId}
          and "archived_at" is null
        returning "id"
      `;
      if (!targets[0]) {
        return null;
      }
      await retireInvalidPortraitReference({ db, ownerId, entityId: targets[0].id });
      if (previous?.image) {
        await recordChange({
          db,
          ownerId,
          change,
          resourceType: 'entity',
          readableId,
          name: previous.name,
          action: 'updated',
          details: [`Removed image “${previous.image.name}”`],
          createdAt: updatedAt,
        });
      }
      return this.findWith({ db, ownerId, readableId });
    });
  }

  archive({
    ownerId,
    readableId,
    archivedAt,
    change,
  }: {
    ownerId: string;
    readableId: string;
    archivedAt: string;
    change: ChangeContext;
  }): Promise<ArchiveResult<KnowledgePageReference> | { state: 'self_entity' }> {
    return this.sql.begin('immediate', async (db) => {
      const targets = await db.FindEntityArchiveTarget`
        /* @notNull id */
        /* @type isSelf number */
        select entity."id", entity."archived_at" as "archivedAt", exists(
          select 1 from "knowledge_profile"
          where "owner_id" = ${ownerId} and "self_entity_id" = entity."id"
        ) as "isSelf", entity."published_at" as "publishedAt"
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
      if (target.publishedAt) {
        return { state: 'resource_published' } as const;
      }
      const blockers = await this.listActiveMentioningPages({
        db,
        ownerId,
        entityId: target.id,
      });
      if (blockers.length > 0) {
        return { state: 'resource_in_use' as const, blockers };
      }
      const previous = await this.findWith({ db, ownerId, readableId });
      await db`
        update "entity"
        set "archived_at" = ${archivedAt}
        where "owner_id" = ${ownerId} and "id" = ${target.id}
      `;
      await retireInvalidPortraitReference({ db, ownerId, entityId: target.id });
      await db.RemoveEntitySearchDocument`
        delete from "hypermedia_search_document"
        where "owner_id" = ${ownerId} and "resource_type" = 'entity'
          and "readable_id" = ${readableId}
      `;
      if (previous) {
        await recordChange({
          db,
          ownerId,
          change,
          resourceType: 'entity',
          readableId,
          name: previous.name,
          action: 'archived',
          details: [previous.description],
          createdAt: archivedAt,
        });
      }
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
        current_referring_revision."temporal_coverage" as "temporalCoverage",
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
