import type { SQL } from 'bun';
import { type Page, pageFrom } from '#lib/pagination.ts';
import type { Asset, AssetSummary, AssetUsage, StoredAsset } from '#models/assets/model.ts';
import type { ArchiveResult } from '#models/resource-archiving/model.ts';

export interface AssetsRepositoryContract {
  create(
    input: StoredAsset,
  ): Promise<{ state: 'created'; asset: StoredAsset } | { state: 'readable_id_conflict' }>;
  list(input: {
    ownerId: string;
    limit: number;
    offset: number;
    query?: string;
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

type AssetRow = {
  id: string;
  ownerId: string;
  readableId: string;
  name: string;
  mediaType: string;
  extension: string | null;
  sizeBytes: number;
  storageKey: string;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
};

type AssetSummaryRow = Omit<AssetRow, 'ownerId' | 'storageKey' | 'contentHash'>;

const ASSET_SELECT = `
  select "id", "owner_id" as "ownerId", "readable_id" as "readableId", "name",
    "media_type" as "mediaType", "extension", "size_bytes" as "sizeBytes",
    "storage_key" as "storageKey", "content_hash" as "contentHash",
    "created_at" as "createdAt", "updated_at" as "updatedAt"
  from "asset"
`;

function storedAssetFrom(row: AssetRow): StoredAsset {
  return { ...row, sizeBytes: Number(row.sizeBytes) };
}

function assetSummaryFrom(row: AssetSummaryRow): AssetSummary {
  return { ...row, sizeBytes: Number(row.sizeBytes) };
}

export class AssetsRepository implements AssetsRepositoryContract {
  constructor(private readonly sql: SQL) {}

  async create(input: StoredAsset) {
    const rows = await this.sql<AssetRow[]>`
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
  }: {
    ownerId: string;
    limit: number;
    offset: number;
    query?: string;
  }) {
    const normalizedQuery = query?.trim() || null;
    const rowsPromise = normalizedQuery
      ? this.sql<AssetSummaryRow[]>`
          select "id", "readable_id" as "readableId", "name", "media_type" as "mediaType",
            "extension", "size_bytes" as "sizeBytes", "created_at" as "createdAt",
            "updated_at" as "updatedAt"
          from "asset"
          where "owner_id" = ${ownerId} and "archived_at" is null
            and (instr(lower("name"), lower(${normalizedQuery})) > 0
              or instr("readable_id", lower(${normalizedQuery})) > 0)
          order by "name" collate nocase, "readable_id" limit ${limit} offset ${offset}
        `
      : this.sql<AssetSummaryRow[]>`
          select "id", "readable_id" as "readableId", "name", "media_type" as "mediaType",
            "extension", "size_bytes" as "sizeBytes", "created_at" as "createdAt",
            "updated_at" as "updatedAt"
          from "asset"
          where "owner_id" = ${ownerId} and "archived_at" is null
          order by "updated_at" desc, "id" desc limit ${limit} offset ${offset}
        `;
    const countsPromise = normalizedQuery
      ? this.sql<Array<{ total: number }>>`
          select count(*) as "total" from "asset"
          where "owner_id" = ${ownerId} and "archived_at" is null
            and (instr(lower("name"), lower(${normalizedQuery})) > 0
              or instr("readable_id", lower(${normalizedQuery})) > 0)
        `
      : this.sql<Array<{ total: number }>>`
          select count(*) as "total" from "asset"
          where "owner_id" = ${ownerId} and "archived_at" is null
        `;
    const [rows, counts] = await Promise.all([rowsPromise, countsPromise]);
    return pageFrom({
      items: rows.map(assetSummaryFrom),
      total: Number(counts[0]?.total ?? 0),
      offset,
    });
  }

  async find({ ownerId, readableId }: { ownerId: string; readableId: string }) {
    const rows = await this.sql.unsafe<AssetRow[]>(
      `${ASSET_SELECT} where "owner_id" = $1 and "readable_id" = $2 and "archived_at" is null`,
      [ownerId, readableId],
    );
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
    const rows = await this.sql<AssetRow[]>`
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
      const targets = await db<Array<{ id: string; archivedAt: string | null }>>`
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
    db: SQL;
    ownerId: string;
    assetId: string;
  }): Promise<AssetUsage[]> {
    const rows = await db<
      Array<{
        id: string;
        readableId: string;
        title: string;
        excerpt: string;
        revisionNumber: number;
        createdAt: string;
        updatedAt: string;
        presentation: 'embed' | 'attachment';
      }>
    >`
      select page."id", page."readable_id" as "readableId", revision."title",
        revision."excerpt", revision."revision_number" as "revisionNumber",
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
    return rows.map(({ presentation, ...page }) => ({
      page: { ...page, revisionNumber: Number(page.revisionNumber) },
      presentation,
    }));
  }
}
