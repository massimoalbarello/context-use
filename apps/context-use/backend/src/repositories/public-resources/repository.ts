import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import { isEmbeddableAssetMedia } from '#backend/models/assets/media.ts';
import { ENTITY_TYPES, type EntityType } from '#backend/models/entities/model.ts';
import type { PublicMarkdownTarget } from '#backend/models/public-resources/markdown.ts';
import type { Queries } from '#backend/queries.gen.ts';

export interface StoredPublicAsset {
  name: string;
  mediaType: string;
  extension: string | null;
  sizeBytes: number;
  contentHash: string;
  storageKey: string;
}

export interface StoredPublicMarkdown {
  title: string;
  storageKey: string;
  contentHash: string;
  sizeBytes: number;
  targets: PublicMarkdownTarget[];
}

export interface StoredPublicPage extends StoredPublicMarkdown {
  modifiedAt: string;
}

export interface PublicEntity {
  modifiedAt: string;
  name: string;
  description: string;
  entityType: EntityType | null;
  imagePublicId: string | null;
  pages: { publicId: string; title: string }[];
}

export interface PublicResourcesRepositoryContract {
  findEntity(input: { publicId: string }): Promise<PublicEntity | null>;
  findPage(input: { publicId: string }): Promise<StoredPublicPage | null>;
  findRecord(input: { publicId: string }): Promise<StoredPublicMarkdown | null>;
  findAsset(input: { publicId: string }): Promise<StoredPublicAsset | null>;
}

export class PublicResourcesRepository implements PublicResourcesRepositoryContract {
  private readonly sql: TypedSQL<Queries>;

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  async findEntity({ publicId }: { publicId: string }): Promise<PublicEntity | null> {
    // Live identity and the exact published revision index share one database snapshot.
    const rows = await this.sql.FindPublicEntity`
      /* @notNull name description modifiedAt */
      /* @type hasImage number */
      with active_entity as (
        select entity."id", entity."owner_id", entity."name", entity."description",
          entity."entity_type", entity."image_asset_id", entity."updated_at"
        from "entity" entity
        where entity."public_id" = ${publicId} and entity."published_at" is not null
          and entity."archived_at" is null
      ), published_mentions as (
        select page."public_id", revision."title"
        from active_entity entity
        join "knowledge_page_entity_mention" mention on mention."target_entity_id" = entity."id"
          and mention."owner_id" = entity."owner_id"
        join "knowledge_page_revision" revision on revision."id" = mention."source_revision_id"
          and revision."owner_id" = entity."owner_id"
        join "knowledge_page" page on page."id" = revision."page_id"
          and page."owner_id" = entity."owner_id" and page."archived_at" is null
          and page."published_at" is not null and page."published_revision_id" = revision."id"
      )
      select entity."name", entity."description", entity."entity_type" as "entityType",
        entity."updated_at" as "modifiedAt",
        entity."image_asset_id" is not null as "hasImage",
        image."public_id" as "imagePublicId", image."media_type" as "imageMediaType",
        page."public_id" as "pagePublicId", page."title" as "pageTitle"
      from active_entity entity
      left join "asset" image on image."id" = entity."image_asset_id"
        and image."owner_id" = entity."owner_id" and image."archived_at" is null
        and image."published_at" is not null
      left join published_mentions page on true
      order by page."title", page."public_id"
    `;
    const entity = rows[0];
    if (
      !entity ||
      (entity.hasImage &&
        (!entity.imagePublicId ||
          !entity.imageMediaType ||
          !isEmbeddableAssetMedia(entity.imageMediaType)))
    ) {
      return null;
    }
    const entityType = ENTITY_TYPES.find((type) => type === entity.entityType) ?? null;
    if (entity.entityType !== null && entityType === null) {
      return null;
    }
    return {
      modifiedAt: entity.modifiedAt,
      name: entity.name,
      description: entity.description,
      entityType,
      imagePublicId: entity.imagePublicId,
      pages: rows.flatMap((row) =>
        row.pagePublicId && row.pageTitle
          ? [{ publicId: row.pagePublicId, title: row.pageTitle }]
          : [],
      ),
    };
  }

  async findPage({ publicId }: { publicId: string }): Promise<StoredPublicPage | null> {
    // One statement selects the approved revision and its retained relationships together.
    const rows = await this.sql.FindPublicPage`
      /* @notNull title storageKey contentHash sizeBytes modifiedAt */
      /* @type publicId string | null */
      /* @type mediaType string | null */
      with active_page as (
        select revision."id", revision."owner_id", revision."title", revision."storage_key",
          revision."content_hash", revision."size_bytes", revision."created_at"
        from "knowledge_page" page
        join "knowledge_page_revision" revision on revision."id" = page."published_revision_id"
          and revision."page_id" = page."id" and revision."owner_id" = page."owner_id"
        where page."public_id" = ${publicId} and page."published_at" is not null
          and page."archived_at" is null
      ), link_targets as (
        select 'page' as "kind", target."readable_id", target."public_id", null as "media_type"
        from active_page source
        join "knowledge_page_reference" link on link."source_revision_id" = source."id"
          and link."owner_id" = source."owner_id"
        left join "knowledge_page" target on target."id" = link."target_page_id"
          and target."owner_id" = source."owner_id" and target."archived_at" is null
          and target."published_at" is not null
          and exists (
            select 1 from "knowledge_page_revision" revision
            where revision."id" = target."published_revision_id" and revision."page_id" = target."id"
              and revision."owner_id" = source."owner_id"
          )
        union all
        select 'entity', target."readable_id", target."public_id", null
        from active_page source
        join "knowledge_page_entity_mention" link on link."source_revision_id" = source."id"
          and link."owner_id" = source."owner_id"
        left join "entity" target on target."id" = link."target_entity_id"
          and target."owner_id" = source."owner_id" and target."archived_at" is null
          and target."published_at" is not null
        union all
        select 'asset', target."readable_id", target."public_id", target."media_type"
        from active_page source
        join "knowledge_page_asset_usage" link on link."source_revision_id" = source."id"
          and link."owner_id" = source."owner_id"
        left join "asset" target on target."id" = link."target_asset_id"
          and target."owner_id" = source."owner_id" and target."archived_at" is null
          and target."published_at" is not null
        union all
        select 'record', link."target_record_readable_id", target."public_id", null
        from active_page source
        join "knowledge_page_record_reference" link on link."source_revision_id" = source."id"
          and link."owner_id" = source."owner_id"
        left join "record" target on target."readable_id" = link."target_record_readable_id"
          and target."owner_id" = source."owner_id" and target."deleted_at" is null
          and target."published_at" is not null
      )
      select source."title", source."created_at" as "modifiedAt", source."storage_key" as "storageKey",
        source."content_hash" as "contentHash", source."size_bytes" as "sizeBytes",
        target."kind", target."readable_id" as "readableId", target."public_id" as "publicId",
        target."media_type" as "mediaType"
      from active_page source left join link_targets target on true
    `;
    const page = rows[0];
    if (!page) {
      return null;
    }
    const targets: PublicMarkdownTarget[] = [];
    for (const target of rows) {
      if (target.kind === null) {
        continue;
      }
      if (
        !target.readableId ||
        !target.publicId ||
        (target.kind !== 'page' &&
          target.kind !== 'entity' &&
          target.kind !== 'asset' &&
          target.kind !== 'record')
      ) {
        return null;
      }
      targets.push({
        kind: target.kind,
        readableId: target.readableId,
        publicId: target.publicId,
        mediaType: target.mediaType,
      });
    }
    return {
      title: page.title,
      modifiedAt: page.modifiedAt,
      storageKey: page.storageKey,
      contentHash: page.contentHash,
      sizeBytes: Number(page.sizeBytes),
      targets,
    };
  }

  async findRecord({ publicId }: { publicId: string }): Promise<StoredPublicMarkdown | null> {
    const rows = await this.sql.FindPublicRecord`
      /* @notNull title storageKey contentHash sizeBytes */
      with active_record as (
        select "owner_id", "readable_id", "title", "storage_key", "content_hash", "size_bytes"
        from "record" where "public_id" = ${publicId} and "published_at" is not null and "deleted_at" is null
      ), link_targets as (
        select 'asset' as "kind", target."readable_id", target."public_id", target."media_type"
        from active_record source
        join "record_asset_usage" usage on usage."owner_id" = source."owner_id"
          and usage."source_record_readable_id" = source."readable_id"
        left join "asset" target on target."id" = usage."target_asset_id" and target."owner_id" = source."owner_id"
          and target."published_at" is not null and target."archived_at" is null
      )
      select source."title", source."storage_key" as "storageKey", source."content_hash" as "contentHash",
        source."size_bytes" as "sizeBytes", target."kind", target."readable_id" as "readableId",
        target."public_id" as "publicId", target."media_type" as "mediaType"
      from active_record source left join link_targets target on true
    `;
    const record = rows[0];
    if (!record) {
      return null;
    }
    const targets: PublicMarkdownTarget[] = [];
    for (const target of rows) {
      if (target.kind === null) {
        continue;
      }
      if (!target.readableId || !target.publicId) {
        return null;
      }
      targets.push({
        kind: 'asset',
        readableId: target.readableId,
        publicId: target.publicId,
        mediaType: target.mediaType,
      });
    }
    return {
      title: record.title,
      storageKey: record.storageKey,
      contentHash: record.contentHash,
      sizeBytes: Number(record.sizeBytes),
      targets,
    };
  }

  async findAsset({ publicId }: { publicId: string }): Promise<StoredPublicAsset | null> {
    const rows = await this.sql.FindPublicAsset`
      /* @notNull name mediaType sizeBytes contentHash storageKey */
      select asset."name", asset."media_type" as "mediaType", asset."extension",
        asset."size_bytes" as "sizeBytes", asset."content_hash" as "contentHash",
        asset."storage_key" as "storageKey"
      from "asset" asset
      where asset."public_id" = ${publicId}
        and asset."published_at" is not null and asset."archived_at" is null
    `;
    const row = rows[0];
    return row
      ? {
          name: row.name,
          mediaType: row.mediaType,
          extension: row.extension,
          sizeBytes: Number(row.sizeBytes),
          contentHash: row.contentHash,
          storageKey: row.storageKey,
        }
      : null;
  }
}
