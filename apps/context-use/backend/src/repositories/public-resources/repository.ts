import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
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

export interface StoredPublicPage {
  title: string;
  storageKey: string;
  contentHash: string;
  sizeBytes: number;
  targets: PublicMarkdownTarget[];
}

export interface PublicResourcesRepositoryContract {
  findPage(input: { publicId: string }): Promise<StoredPublicPage | null>;
  findAsset(input: { publicId: string }): Promise<StoredPublicAsset | null>;
}

export class PublicResourcesRepository implements PublicResourcesRepositoryContract {
  private readonly sql: TypedSQL<Queries>;

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  async findPage({ publicId }: { publicId: string }): Promise<StoredPublicPage | null> {
    // One statement selects the approved revision and its retained relationships together.
    const rows = await this.sql.FindPublicPage`
      /* @notNull title storageKey contentHash sizeBytes */
      /* @type publicId string | null */
      /* @type mediaType string | null */
      with active_page as (
        select revision."id", revision."owner_id", revision."title", revision."storage_key",
          revision."content_hash", revision."size_bytes"
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
        select 'record', link."target_record_readable_id", null, null
        from active_page source
        join "knowledge_page_record_reference" link on link."source_revision_id" = source."id"
          and link."owner_id" = source."owner_id"
      )
      select source."title", source."storage_key" as "storageKey",
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
        (target.kind !== 'page' && target.kind !== 'entity' && target.kind !== 'asset')
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
      storageKey: page.storageKey,
      contentHash: page.contentHash,
      sizeBytes: Number(page.sizeBytes),
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
