import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import { type Page, pageFrom } from '#lib/pagination.ts';
import type { Asset, AssetSummary, AssetUsage, StoredAsset } from '#models/assets/model.ts';
import type { ArchiveResult } from '#models/resource-archiving/model.ts';
import type { Queries } from '#queries.gen.ts';

export interface AssetsRepositoryContract {
  create(
    input: StoredAsset,
  ): Promise<{ state: 'created'; asset: StoredAsset } | { state: 'readable_id_conflict' }>;
  list(input: {
    ownerId: string;
    limit: number;
    offset: number;
    query?: string;
    kind?: 'entity_image';
  }): Promise<Page<AssetSummary>>;
  find(input: { ownerId: string; readableId: string }): Promise<StoredAsset | null>;
  detail(input: { ownerId: string; readableId: string }): Promise<Asset | null>;
  updateName(input: {
    ownerId: string;
    readableId: string;
    name: string;
    updatedAt: string;
  }): Promise<Asset | null>;
  archive(input: {
    ownerId: string;
    readableId: string;
    archivedAt: string;
  }): Promise<ArchiveResult<AssetUsage>>;
}

type AssetRow = Queries['CreateAsset'];

type AssetSummaryRow = Queries['SearchAssets'];

function storedAssetFrom(row: AssetRow): StoredAsset {
  return { ...row, sizeBytes: Number(row.sizeBytes) };
}

function assetSummaryFrom(row: AssetSummaryRow): AssetSummary {
  return { ...row, sizeBytes: Number(row.sizeBytes) };
}

export class AssetsRepository implements AssetsRepositoryContract {
  private readonly sql: TypedSQL<Queries>;

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  async create(input: StoredAsset) {
    const rows = await this.sql.CreateAsset`
      /* @notNull id ownerId readableId name mediaType sizeBytes storageKey contentHash createdAt updatedAt */
      insert into "asset"
        ("id", "owner_id", "readable_id", "name", "media_type", "extension", "size_bytes",
         "content_hash", "storage_key", "created_at", "updated_at")
      values
        (${input.id}, ${input.ownerId}, ${input.readableId}, ${input.name}, ${input.mediaType},
         ${input.extension}, ${input.sizeBytes}, ${input.contentHash}, ${input.storageKey},
         ${input.createdAt}, ${input.updatedAt})
      on conflict ("owner_id", "readable_id") do nothing
      returning "id", "owner_id" as "ownerId", "readable_id" as "readableId", "name",
        "media_type" as "mediaType", "extension", "size_bytes" as "sizeBytes",
        "storage_key" as "storageKey", "content_hash" as "contentHash",
        "created_at" as "createdAt", "updated_at" as "updatedAt"
    `;
    return rows[0]
      ? { state: 'created' as const, asset: storedAssetFrom(rows[0]) }
      : { state: 'readable_id_conflict' as const };
  }

  async list({
    ownerId,
    limit,
    offset,
    query,
    kind,
  }: {
    ownerId: string;
    limit: number;
    offset: number;
    query?: string;
    kind?: 'entity_image';
  }) {
    const normalizedQuery = query?.trim() || null;
    const normalizedKind = kind ?? null;
    const rowsPromise = normalizedQuery
      ? this.sql.SearchAssets`
          /* @notNull id readableId name mediaType sizeBytes createdAt updatedAt */
          select "id", "readable_id" as "readableId", "name", "media_type" as "mediaType",
            "extension", "size_bytes" as "sizeBytes", "created_at" as "createdAt",
            "updated_at" as "updatedAt"
          from "asset"
          where "owner_id" = ${ownerId} and "archived_at" is null
            and (${normalizedKind} is null or (
              "media_type" like 'image/%'
              and not exists (
                select 1 from "entity"
                where "entity"."owner_id" = "asset"."owner_id"
                  and "entity"."image_asset_id" = "asset"."id"
              )
            ))
            and (instr(lower("name"), lower(${normalizedQuery})) > 0
              or instr("readable_id", lower(${normalizedQuery})) > 0)
          order by "name" collate nocase, "readable_id" limit ${limit} offset ${offset}
        `
      : this.sql.ListAssets`
          /* @notNull id readableId name mediaType sizeBytes createdAt updatedAt */
          select "id", "readable_id" as "readableId", "name", "media_type" as "mediaType",
            "extension", "size_bytes" as "sizeBytes", "created_at" as "createdAt",
            "updated_at" as "updatedAt"
          from "asset"
          where "owner_id" = ${ownerId} and "archived_at" is null
            and (${normalizedKind} is null or (
              "media_type" like 'image/%'
              and not exists (
                select 1 from "entity"
                where "entity"."owner_id" = "asset"."owner_id"
                  and "entity"."image_asset_id" = "asset"."id"
              )
            ))
          order by "updated_at" desc, "id" desc limit ${limit} offset ${offset}
        `;
    const countsPromise = normalizedQuery
      ? this.sql.CountSearchedAssets`
          /* @notNull total */
          select count(*) as "total" from "asset"
          where "owner_id" = ${ownerId} and "archived_at" is null
            and (${normalizedKind} is null or (
              "media_type" like 'image/%'
              and not exists (
                select 1 from "entity"
                where "entity"."owner_id" = "asset"."owner_id"
                  and "entity"."image_asset_id" = "asset"."id"
              )
            ))
            and (instr(lower("name"), lower(${normalizedQuery})) > 0
              or instr("readable_id", lower(${normalizedQuery})) > 0)
        `
      : this.sql.CountAssets`
          /* @notNull total */
          select count(*) as "total" from "asset"
          where "owner_id" = ${ownerId} and "archived_at" is null
            and (${normalizedKind} is null or (
              "media_type" like 'image/%'
              and not exists (
                select 1 from "entity"
                where "entity"."owner_id" = "asset"."owner_id"
                  and "entity"."image_asset_id" = "asset"."id"
              )
            ))
        `;
    const [rows, counts] = await Promise.all([rowsPromise, countsPromise]);
    return pageFrom({
      items: rows.map(assetSummaryFrom),
      total: Number(counts[0]?.total ?? 0),
      offset,
    });
  }

  async find({ ownerId, readableId }: { ownerId: string; readableId: string }) {
    const rows = await this.sql.FindAsset`
      /* @notNull id ownerId readableId name mediaType sizeBytes storageKey contentHash createdAt updatedAt */
      select "id", "owner_id" as "ownerId", "readable_id" as "readableId", "name",
        "media_type" as "mediaType", "extension", "size_bytes" as "sizeBytes",
        "storage_key" as "storageKey", "content_hash" as "contentHash",
        "created_at" as "createdAt", "updated_at" as "updatedAt"
      from "asset"
      where "owner_id" = ${ownerId} and "readable_id" = ${readableId}
        and "archived_at" is null
    `;
    return rows[0] ? storedAssetFrom(rows[0]) : null;
  }

  async detail({
    ownerId,
    readableId,
  }: {
    ownerId: string;
    readableId: string;
  }): Promise<Asset | null> {
    const asset = await this.find({ ownerId, readableId });
    if (!asset) {
      return null;
    }
    return {
      ...this.summary(asset),
      usages: await this.listActiveUsages({ db: this.sql, ownerId, assetId: asset.id }),
    };
  }

  async updateName(input: {
    ownerId: string;
    readableId: string;
    name: string;
    updatedAt: string;
  }) {
    const rows = await this.sql.UpdateAssetName`
      /* @notNull id ownerId readableId name mediaType sizeBytes storageKey contentHash createdAt updatedAt */
      update "asset" set "name" = ${input.name}, "updated_at" = ${input.updatedAt}
      where "owner_id" = ${input.ownerId} and "readable_id" = ${input.readableId}
        and "archived_at" is null
      returning "id", "owner_id" as "ownerId", "readable_id" as "readableId", "name",
        "media_type" as "mediaType", "extension", "size_bytes" as "sizeBytes",
        "storage_key" as "storageKey", "content_hash" as "contentHash",
        "created_at" as "createdAt", "updated_at" as "updatedAt"
    `;
    if (!rows[0]) {
      return null;
    }
    const asset = storedAssetFrom(rows[0]);
    return {
      ...this.summary(asset),
      usages: await this.listActiveUsages({
        db: this.sql,
        ownerId: input.ownerId,
        assetId: asset.id,
      }),
    };
  }

  archive(input: {
    ownerId: string;
    readableId: string;
    archivedAt: string;
  }): Promise<ArchiveResult<AssetUsage>> {
    return this.sql.begin(async (db) => {
      const targets = await db.FindAssetArchiveTarget`
        /* @notNull id */
        select "id", "archived_at" as "archivedAt" from "asset"
        where "owner_id" = ${input.ownerId} and "readable_id" = ${input.readableId}
      `;
      const target = targets[0];
      if (!target) {
        return { state: 'not_found' } as const;
      }
      if (target.archivedAt) {
        return { state: 'archived' } as const;
      }
      const blockers = await this.listActiveUsages({
        db,
        ownerId: input.ownerId,
        assetId: target.id,
      });
      if (blockers.length > 0) {
        return { state: 'resource_in_use' as const, blockers };
      }
      await db`
        update "asset" set "archived_at" = ${input.archivedAt}
        where "owner_id" = ${input.ownerId} and "id" = ${target.id}
      `;
      return { state: 'archived' } as const;
    });
  }

  private summary(asset: StoredAsset): AssetSummary {
    const {
      ownerId: _ownerId,
      storageKey: _storageKey,
      contentHash: _contentHash,
      ...summary
    } = asset;
    return summary;
  }

  private async listActiveUsages({
    db,
    ownerId,
    assetId,
  }: {
    db: TypedSQL<Queries>;
    ownerId: string;
    assetId: string;
  }): Promise<AssetUsage[]> {
    const pageRows = await db.ListActivePageAssetUsages`
      /* @notNull id readableId title excerpt revisionNumber createdAt updatedAt */
      /* @type presentation 'embed' | 'attachment' */
      select page."id", page."readable_id" as "readableId", revision."title",
        revision."excerpt", revision."revision_number" as "revisionNumber",
        revision."temporal_coverage" as "temporalCoverage",
        page."created_at" as "createdAt", page."updated_at" as "updatedAt", usage."presentation"
      from "knowledge_page_asset_usage" usage
      join "knowledge_page" page
        on page."current_revision_id" = usage."source_revision_id"
       and page."owner_id" = usage."owner_id"
      join "knowledge_page_revision" revision on revision."id" = page."current_revision_id"
      where usage."owner_id" = ${ownerId} and usage."target_asset_id" = ${assetId}
        and page."archived_at" is null
      order by revision."title", page."readable_id", usage."presentation"
    `;
    const entityRows = await db.ListActiveEntityImageAssetUsages`
      /* @notNull id readableId name description */
      /* @type isSelf number */
      select entity."id", entity."readable_id" as "readableId", entity."name",
        entity."description", profile."self_entity_id" is not null as "isSelf"
      from "entity" entity
      left join "knowledge_profile" profile
        on profile."owner_id" = entity."owner_id" and profile."self_entity_id" = entity."id"
      where entity."owner_id" = ${ownerId} and entity."image_asset_id" = ${assetId}
        and entity."archived_at" is null
      order by entity."name" collate nocase, entity."readable_id"
    `;
    return [
      ...pageRows.map(({ presentation, ...page }) => ({
        kind: 'page' as const,
        page: { ...page, revisionNumber: Number(page.revisionNumber) },
        presentation,
      })),
      ...entityRows.map((entity) => ({
        kind: 'entity_image' as const,
        entity: { ...entity, isSelf: Boolean(entity.isSelf) },
      })),
    ];
  }
}
