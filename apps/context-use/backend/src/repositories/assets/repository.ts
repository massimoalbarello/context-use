import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import { type Page, pageFrom } from '#backend/lib/pagination.ts';
import { SerialQueue } from '#backend/lib/serial-queue.ts';
import type { ImportedAsset } from '#backend/models/assets/import.ts';
import type { Asset, AssetSummary, AssetUsage, StoredAsset } from '#backend/models/assets/model.ts';
import type { ArchiveResult } from '#backend/models/resource-archiving/model.ts';
import type { Queries } from '#backend/queries.gen.ts';
import { entityTypeFrom } from '#backend/views/entities/entity-view.ts';
import { replaceSearchDocument } from '../search-index.ts';
import { type AssetImportIdentity, checkAssetImport, findAssetImport } from './imports.ts';

export interface CreateAssetInput {
  asset: Omit<StoredAsset, 'origin'>;
  sync?: { syncId: string; key: string };
}

export type AssetPublication =
  | { state: 'created'; asset: StoredAsset }
  | { state: 'existing'; asset: ImportedAsset }
  | { state: 'readable_id_conflict' | 'sync_conflict' | 'inactive_sync' };

export interface AssetsRepositoryContract {
  create(input: CreateAssetInput): Promise<AssetPublication>;
  findImport(input: AssetImportIdentity): Promise<ImportedAsset | null>;
  list(input: {
    ownerId: string;
    limit: number;
    offset: number;
    kind?: 'entity_image';
  }): Promise<Page<AssetSummary>>;
  find(input: { ownerId: string; readableId: string }): Promise<StoredAsset | null>;
  detail(input: {
    ownerId: string;
    readableId: string;
    usageLimit?: number;
  }): Promise<Asset | null>;
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

type AssetSummaryRow = Queries['ListAssets'];

function storedAssetFrom(row: AssetRow): StoredAsset {
  return { ...row, sizeBytes: Number(row.sizeBytes) };
}

function assetSummaryFrom(row: AssetSummaryRow): AssetSummary {
  return { ...row, sizeBytes: Number(row.sizeBytes) };
}

export class AssetsRepository implements AssetsRepositoryContract {
  private readonly sql: TypedSQL<Queries>;
  private readonly operations = new SerialQueue();

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  findImport(input: AssetImportIdentity): Promise<ImportedAsset | null> {
    return this.operations.run(() => findAssetImport({ db: this.sql, input }));
  }

  create({ asset: input, sync }: CreateAssetInput): Promise<AssetPublication> {
    const origin = sync ? 'sync' : 'upload';
    return this.operations.run(() =>
      this.sql.begin('immediate', async (db) => {
        if (sync) {
          const identity = { ownerId: input.ownerId, ...sync };
          const acceptance = await checkAssetImport({
            db,
            input: identity,
            contentHash: input.contentHash,
            sizeBytes: input.sizeBytes,
          });
          if (acceptance) {
            return acceptance;
          }
        }
        const rows = await db.CreateAsset`
        /* @notNull id ownerId readableId name mediaType sizeBytes storageKey contentHash createdAt updatedAt origin */
        /* @type origin 'upload' | 'sync' */
        insert into "asset"
          ("id", "owner_id", "readable_id", "name", "media_type", "extension", "size_bytes",
           "content_hash", "storage_key", "created_at", "updated_at", "origin")
        values
          (${input.id}, ${input.ownerId}, ${input.readableId}, ${input.name}, ${input.mediaType},
           ${input.extension}, ${input.sizeBytes}, ${input.contentHash}, ${input.storageKey},
           ${input.createdAt}, ${input.updatedAt}, ${origin})
        on conflict ("owner_id", "readable_id") do nothing
        returning "id", "owner_id" as "ownerId", "readable_id" as "readableId", "name",
          "media_type" as "mediaType", "extension", "size_bytes" as "sizeBytes",
          "storage_key" as "storageKey", "content_hash" as "contentHash", "origin",
          "created_at" as "createdAt", "updated_at" as "updatedAt"
      `;
        if (!rows[0]) {
          return { state: 'readable_id_conflict' } as const;
        }
        if (sync) {
          await db.InsertAssetImport`
          insert into "asset_import" ("owner_id", "sync_id", "import_key", "asset_id")
          values (${input.ownerId}, ${sync.syncId}, ${sync.key}, ${input.id})
        `;
        }
        await replaceSearchDocument({
          db,
          ownerId: input.ownerId,
          resourceType: 'asset',
          readableId: input.readableId,
          label: input.name,
          metadata: [input.mediaType, input.extension].filter(Boolean).join(' '),
        });
        return { state: 'created' as const, asset: storedAssetFrom(rows[0]) };
      }),
    );
  }

  async list({
    ownerId,
    limit,
    offset,
    kind,
  }: {
    ownerId: string;
    limit: number;
    offset: number;
    kind?: 'entity_image';
  }) {
    return await this.operations.run(async () => {
      const normalizedKind = kind ?? null;
      const rowsPromise = this.sql.ListAssets`
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
      const countsPromise = this.sql.CountAssets`
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
    });
  }

  find(input: { ownerId: string; readableId: string }): Promise<StoredAsset | null> {
    return this.operations.run(() => this.findAsset(input));
  }

  private async findAsset({ ownerId, readableId }: { ownerId: string; readableId: string }) {
    const rows = await this.sql.FindAsset`
      /* @notNull id ownerId readableId name mediaType sizeBytes storageKey contentHash createdAt updatedAt origin */
        /* @type origin 'upload' | 'sync' */
      select "id", "owner_id" as "ownerId", "readable_id" as "readableId", "name",
        "media_type" as "mediaType", "extension", "size_bytes" as "sizeBytes",
        "storage_key" as "storageKey", "content_hash" as "contentHash", "origin",
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
    usageLimit,
  }: {
    ownerId: string;
    readableId: string;
    usageLimit?: number;
  }): Promise<Asset | null> {
    return await this.operations.run(async () => {
      const asset = await this.findAsset({ ownerId, readableId });
      if (!asset) {
        return null;
      }
      return this.assetDetail({ db: this.sql, asset, usageLimit });
    });
  }

  updateName(input: { ownerId: string; readableId: string; name: string; updatedAt: string }) {
    return this.operations.run(() =>
      this.sql.begin('immediate', async (db) => {
        const rows = await db.UpdateAssetName`
        /* @notNull id ownerId readableId name mediaType sizeBytes storageKey contentHash createdAt updatedAt origin */
        /* @type origin 'upload' | 'sync' */
        update "asset" set "name" = ${input.name}, "updated_at" = ${input.updatedAt}
        where "owner_id" = ${input.ownerId} and "readable_id" = ${input.readableId}
          and "archived_at" is null
        returning "id", "owner_id" as "ownerId", "readable_id" as "readableId", "name",
          "media_type" as "mediaType", "extension", "size_bytes" as "sizeBytes",
          "storage_key" as "storageKey", "content_hash" as "contentHash", "origin",
          "created_at" as "createdAt", "updated_at" as "updatedAt"
      `;
        if (!rows[0]) {
          return null;
        }
        await replaceSearchDocument({
          db,
          ownerId: input.ownerId,
          resourceType: 'asset',
          readableId: input.readableId,
          label: input.name,
          metadata: [rows[0].mediaType, rows[0].extension].filter(Boolean).join(' '),
        });
        return this.assetDetail({ db, asset: storedAssetFrom(rows[0]) });
      }),
    );
  }

  archive(input: {
    ownerId: string;
    readableId: string;
    archivedAt: string;
  }): Promise<ArchiveResult<AssetUsage>> {
    return this.operations.run(() =>
      this.sql.begin('immediate', async (db) => {
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
        await db.RemoveAssetSearchDocument`
        delete from "hypermedia_search_document"
        where "owner_id" = ${input.ownerId} and "resource_type" = 'asset'
          and "readable_id" = ${input.readableId}
      `;
        return { state: 'archived' } as const;
      }),
    );
  }

  private async assetDetail({
    db,
    asset,
    usageLimit,
  }: {
    db: TypedSQL<Queries>;
    asset: StoredAsset;
    usageLimit?: number;
  }): Promise<Asset> {
    const syncs =
      asset.origin === 'sync'
        ? await db.FindAssetSync`
      /* @notNull readableId name */
      select sync."readable_id" as "readableId", sync."name"
      from "asset_import" source
      join "record_sync" sync on sync."id" = source."sync_id"
        and sync."owner_id" = source."owner_id"
      where source."owner_id" = ${asset.ownerId} and source."asset_id" = ${asset.id}
    `
        : [];
    return {
      ...this.summary(asset),
      origin: asset.origin,
      sync: syncs[0] ?? null,
      depicts: await this.depicts({ db, ownerId: asset.ownerId, assetId: asset.id }),
      usages: await this.listActiveUsages({
        db,
        ownerId: asset.ownerId,
        assetId: asset.id,
        limit: usageLimit,
      }),
    };
  }

  private async depicts({
    db,
    ownerId,
    assetId,
  }: {
    db: TypedSQL<Queries>;
    ownerId: string;
    assetId: string;
  }): Promise<Asset['depicts']> {
    const rows = await db.ListAssetDepictedPeople`
      /* @notNull id readableId name description source */
      /* @type isSelf number */
      /* @type source 'detected' | 'confirmed' */
      select entity."id", entity."readable_id" as "readableId", entity."name", entity."description",
        entity."entity_type" as "entityType", profile."self_entity_id" is not null as "isSelf",
        case when max(link."source" = 'confirmed') then 'confirmed' else 'detected' end as "source"
      from "asset_depicts_entity" link
      join "entity" entity on entity."id" = link."entity_id" and entity."owner_id" = link."owner_id"
      left join "knowledge_profile" profile on profile."owner_id" = entity."owner_id" and profile."self_entity_id" = entity."id"
      where link."owner_id" = ${ownerId} and link."asset_id" = ${assetId}
        and entity."archived_at" is null and entity."entity_type" = 'person'
      group by entity."id"
      order by entity."name" collate nocase, entity."readable_id"
    `;
    return rows.map(({ source, ...entity }) => ({
      source,
      entity: {
        ...entity,
        entityType: entityTypeFrom(entity.entityType),
        isSelf: Boolean(entity.isSelf),
      },
    }));
  }

  private summary(asset: StoredAsset): AssetSummary {
    const {
      origin: _origin,
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
    limit,
  }: {
    db: TypedSQL<Queries>;
    ownerId: string;
    assetId: string;
    limit?: number;
  }): Promise<AssetUsage[]> {
    const pageUsageLimit = limit ?? -1;
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
      limit ${pageUsageLimit}
    `;
    const entityUsageLimit = limit === undefined ? -1 : Math.max(0, limit - pageRows.length);
    const entityRows =
      entityUsageLimit === 0
        ? []
        : await db.ListActiveEntityImageAssetUsages`
      /* @notNull id readableId name description */
      /* @type isSelf number */
      select entity."id", entity."readable_id" as "readableId", entity."name",
        entity."description", entity."entity_type" as "entityType", profile."self_entity_id" is not null as "isSelf"
      from "entity" entity
      left join "knowledge_profile" profile
        on profile."owner_id" = entity."owner_id" and profile."self_entity_id" = entity."id"
      where entity."owner_id" = ${ownerId} and entity."image_asset_id" = ${assetId}
        and entity."archived_at" is null
      order by entity."name" collate nocase, entity."readable_id"
      limit ${entityUsageLimit}
    `;
    return [
      ...pageRows.map(({ presentation, ...page }) => ({
        kind: 'page' as const,
        page: { ...page, revisionNumber: Number(page.revisionNumber) },
        presentation,
      })),
      ...entityRows.map((entity) => ({
        kind: 'entity_image' as const,
        entity: {
          ...entity,
          entityType: entityTypeFrom(entity.entityType),
          isSelf: Boolean(entity.isSelf),
        },
      })),
    ];
  }
}
