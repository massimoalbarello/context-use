import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type {
  HypermediaResourceType,
  HypermediaRetrievalFilters,
  HypermediaRetrievalResult,
  HypermediaRetrievalResults,
} from '#models/hypermedia-retrieval/model.ts';
import {
  MAX_HYPERMEDIA_MATCH_EXCERPT_LENGTH,
  MAX_HYPERMEDIA_SEARCH_LIMIT,
  MAX_RECORD_TITLE_PREVIEW_LENGTH,
} from '#models/hypermedia-retrieval/model.ts';
import type { Queries } from '#queries.gen.ts';
import type { HypermediaRetrievalRepositoryContract } from './contract.ts';

const MATCH_START = '\u{e000}';
const MATCH_END = '\u{e001}';
const MATCH_ELLIPSIS = ' … ';
const MATCH_EXCERPT_TOKENS = 32;

type SearchRow = Queries['SearchHypermedia'];

function queryTokens(query: string): string[] {
  return [...query.matchAll(/[\p{L}\p{N}]+/gu)].map(([token]) => token.toLowerCase());
}

function ftsQuery(query: string): string | null {
  const tokens = [...new Set(queryTokens(query))];
  return tokens.length > 0 ? tokens.map((token) => `"${token}"*`).join(' OR ') : null;
}

function matchExcerpt(raw: string | null): string | null {
  if (!raw?.includes(MATCH_START)) {
    return null;
  }
  const text = raw.replaceAll(MATCH_START, '').replaceAll(MATCH_END, '').trim();
  if (text.length <= MAX_HYPERMEDIA_MATCH_EXCERPT_LENGTH) {
    return text;
  }
  const contextBeforeMatch = 80;
  const start = Math.max(0, raw.indexOf(MATCH_START) - contextBeforeMatch);
  const prefix = start > 0 ? '… ' : '';
  const length = MAX_HYPERMEDIA_MATCH_EXCERPT_LENGTH - prefix.length - 1;
  return `${prefix}${text.slice(start, start + length).trim()}…`;
}

function imageFrom(row: SearchRow) {
  return row.imageId &&
    row.imageReadableId &&
    row.imageName &&
    row.imageMediaType &&
    row.imageSizeBytes !== null &&
    row.imageCreatedAt &&
    row.imageUpdatedAt
    ? {
        id: row.imageId,
        readableId: row.imageReadableId,
        name: row.imageName,
        mediaType: row.imageMediaType,
        extension: row.imageExtension,
        sizeBytes: Number(row.imageSizeBytes),
        createdAt: row.imageCreatedAt,
        updatedAt: row.imageUpdatedAt,
      }
    : null;
}

function resultFrom(row: SearchRow): HypermediaRetrievalResult {
  const excerpt = matchExcerpt(row.rawMatchExcerpt);
  if (row.resourceType === 'entity') {
    if (!(row.entityId && row.entityName && row.entityDescription)) {
      throw new Error('Hypermedia entity search projection is incomplete');
    }
    return {
      resourceType: row.resourceType,
      entity: {
        id: row.entityId,
        readableId: row.readableId,
        name: row.entityName,
        description: row.entityDescription,
        isSelf: Boolean(row.isSelf),
        image: imageFrom(row),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      matchExcerpt: excerpt,
    };
  }
  if (row.resourceType === 'knowledge_page') {
    if (!(row.pageId && row.pageTitle !== null && row.pageExcerpt !== null && row.revisionNumber)) {
      throw new Error('Hypermedia knowledge-page search projection is incomplete');
    }
    return {
      resourceType: row.resourceType,
      knowledgePage: {
        id: row.pageId,
        readableId: row.readableId,
        title: row.pageTitle,
        excerpt: row.pageExcerpt,
        temporalCoverage: row.temporalCoverage,
        revisionNumber: Number(row.revisionNumber),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      matchExcerpt: excerpt,
    };
  }
  if (row.resourceType === 'record') {
    if (!(row.recordKind && row.recordId && row.syncReadableId && row.syncName)) {
      throw new Error('Hypermedia record search projection is incomplete');
    }
    return {
      resourceType: row.resourceType,
      record: {
        readableId: row.readableId,
        kind: row.recordKind,
        recordId: row.recordId,
        sync: { readableId: row.syncReadableId, name: row.syncName },
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      title: row.recordTitle || null,
      matchExcerpt: excerpt,
    };
  }
  if (!(row.assetId && row.assetName && row.mediaType && row.assetSizeBytes !== null)) {
    throw new Error('Hypermedia asset search projection is incomplete');
  }
  return {
    resourceType: row.resourceType,
    asset: {
      id: row.assetId,
      readableId: row.readableId,
      name: row.assetName,
      mediaType: row.mediaType,
      extension: row.assetExtension,
      sizeBytes: Number(row.assetSizeBytes),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    matchExcerpt: excerpt,
  };
}

export class HypermediaRetrievalRepository implements HypermediaRetrievalRepositoryContract {
  private readonly sql: TypedSQL<Queries>;

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  async search({
    ownerId,
    query,
    resourceTypes,
    limit,
    filters,
  }: {
    ownerId: string;
    query: string;
    resourceTypes: HypermediaResourceType[];
    limit: number;
    filters?: HypermediaRetrievalFilters;
  }): Promise<HypermediaRetrievalResults> {
    const expression = ftsQuery(query);
    if (!expression) {
      return { results: [], totalMatches: 0, truncated: false };
    }
    const selectedTypes = JSON.stringify(resourceTypes);
    const pageInterval = filters?.knowledgePage?.interval ?? null;
    const filterStart = filters?.knowledgePage?.temporalBounds?.start ?? null;
    const filterEnd = filters?.knowledgePage?.temporalBounds?.end ?? null;
    const assetKind = filters?.asset?.kind ?? null;
    const boundedLimit = Math.min(Math.max(limit, 1), MAX_HYPERMEDIA_SEARCH_LIMIT);
    const [rows, counts] = await this.sql.begin((db) =>
      Promise.all([
        db.SearchHypermedia`
      /* @notNull resourceType readableId rawMatchExcerpt createdAt updatedAt */
      /* @type resourceType 'entity' | 'knowledge_page' | 'asset' | 'record' */
      /* @type isSelf number */
      /* @type revisionNumber number */
      /* @type rawMatchExcerpt string */
      /* @type createdAt string */
      /* @type updatedAt string */
      /* @type recordTitle string */
      with selected_type as (
        select value as "resourceType" from json_each(${selectedTypes})
      )
      select document."resource_type" as "resourceType",
        document."readable_id" as "readableId",
        snippet("hypermedia_search_fts", case when document."resource_type" = 'record' then -1 else 3 end, ${MATCH_START}, ${MATCH_END}, ${MATCH_ELLIPSIS},
          ${MATCH_EXCERPT_TOKENS}) as "rawMatchExcerpt",
        entity."id" as "entityId", entity."name" as "entityName",
        entity."description" as "entityDescription",
        coalesce(profile."self_entity_id" is not null, 0) as "isSelf",
        image."id" as "imageId", image."readable_id" as "imageReadableId",
        image."name" as "imageName", image."media_type" as "imageMediaType",
        image."extension" as "imageExtension", image."size_bytes" as "imageSizeBytes",
        image."created_at" as "imageCreatedAt", image."updated_at" as "imageUpdatedAt",
        page."id" as "pageId", revision."title" as "pageTitle",
        revision."excerpt" as "pageExcerpt", revision."revision_number" as "revisionNumber",
        revision."temporal_coverage" as "temporalCoverage",
        asset."id" as "assetId", asset."name" as "assetName",
        asset."media_type" as "mediaType", asset."extension" as "assetExtension",
        asset."size_bytes" as "assetSizeBytes",
        record."kind" as "recordKind", record."record_id" as "recordId",
        substr(document."label", 1, ${MAX_RECORD_TITLE_PREVIEW_LENGTH}) as "recordTitle",
        sync."readable_id" as "syncReadableId", sync."name" as "syncName",
        case document."resource_type"
          when 'entity' then entity."created_at"
          when 'knowledge_page' then page."created_at"
          when 'record' then record."created_at"
          else asset."created_at"
        end as "createdAt",
        case document."resource_type"
          when 'entity' then entity."updated_at"
          when 'knowledge_page' then page."updated_at"
          when 'record' then record."updated_at"
          else asset."updated_at"
        end as "updatedAt"
      from "hypermedia_search_fts"
      join "hypermedia_search_document" document
        on document."id" = "hypermedia_search_fts"."rowid"
      left join "entity" entity
        on document."resource_type" = 'entity'
       and entity."owner_id" = document."owner_id"
       and entity."readable_id" = document."readable_id"
       and entity."archived_at" is null
      left join "knowledge_profile" profile
        on profile."owner_id" = entity."owner_id" and profile."self_entity_id" = entity."id"
      left join "asset" image
        on image."owner_id" = entity."owner_id" and image."id" = entity."image_asset_id"
       and image."archived_at" is null
      left join "knowledge_page" page
        on document."resource_type" = 'knowledge_page'
       and page."owner_id" = document."owner_id"
       and page."readable_id" = document."readable_id"
       and page."archived_at" is null
      left join "knowledge_page_revision" revision
        on revision."owner_id" = page."owner_id" and revision."id" = page."current_revision_id"
      left join "asset" asset
        on document."resource_type" = 'asset'
       and asset."owner_id" = document."owner_id"
       and asset."readable_id" = document."readable_id"
       and asset."archived_at" is null
      left join "record" record
        on document."resource_type" = 'record'
       and record."owner_id" = document."owner_id"
       and record."readable_id" = document."readable_id"
       and record."operation" <> 'deleted'
      left join "record_sync" sync
        on sync."id" = record."sync_id" and sync."owner_id" = record."owner_id"
      where "hypermedia_search_fts" match ${expression}
        and document."owner_id" = ${ownerId}
        and document."resource_type" in (select "resourceType" from selected_type)
        and (
          (document."resource_type" = 'entity' and entity."id" is not null)
          or (document."resource_type" = 'knowledge_page' and page."id" is not null)
          or (document."resource_type" = 'asset' and asset."id" is not null)
          or (document."resource_type" = 'record' and record."readable_id" is not null)
        )
        and (
          document."resource_type" <> 'knowledge_page'
          or ${pageInterval} is null
          or (${pageInterval} = 'without' and revision."temporal_coverage" is null)
          or (${pageInterval} = 'with' and revision."temporal_coverage" is not null)
        )
        and (
          document."resource_type" <> 'knowledge_page'
          or ${filterStart} is null
          or (
            revision."temporal_coverage" is not null and
            (${filterEnd} is null or revision."temporal_start_ms" < ${filterEnd})
            and (revision."temporal_end_exclusive_ms" is null
              or revision."temporal_end_exclusive_ms" > ${filterStart})
          )
        )
        and (
          document."resource_type" <> 'asset'
          or ${assetKind} is null
          or (
            asset."media_type" like 'image/%'
            and not exists (
              select 1 from "entity" assignment
              where assignment."owner_id" = asset."owner_id"
                and assignment."image_asset_id" = asset."id"
            )
          )
        )
      order by bm25("hypermedia_search_fts", 8.0, 6.0, 3.0, 1.0, 2.0),
        document."resource_type", document."readable_id"
      limit ${boundedLimit}
      `,
        db.CountHypermediaSearchMatches`
        /* @notNull total */
        /* @type total number */
        with selected_type as (
          select value as "resourceType" from json_each(${selectedTypes})
        )
        select count(*) as "total"
        from "hypermedia_search_fts"
        join "hypermedia_search_document" document
          on document."id" = "hypermedia_search_fts"."rowid"
        left join "entity" entity
          on document."resource_type" = 'entity'
         and entity."owner_id" = document."owner_id"
         and entity."readable_id" = document."readable_id"
         and entity."archived_at" is null
        left join "knowledge_page" page
          on document."resource_type" = 'knowledge_page'
         and page."owner_id" = document."owner_id"
         and page."readable_id" = document."readable_id"
         and page."archived_at" is null
        left join "knowledge_page_revision" revision
          on revision."owner_id" = page."owner_id" and revision."id" = page."current_revision_id"
        left join "asset" asset
          on document."resource_type" = 'asset'
         and asset."owner_id" = document."owner_id"
         and asset."readable_id" = document."readable_id"
         and asset."archived_at" is null
        left join "record" record
          on document."resource_type" = 'record'
         and record."owner_id" = document."owner_id"
         and record."readable_id" = document."readable_id"
         and record."operation" <> 'deleted'
        left join "record_sync" sync
          on sync."id" = record."sync_id" and sync."owner_id" = record."owner_id"
        where "hypermedia_search_fts" match ${expression}
          and document."owner_id" = ${ownerId}
          and document."resource_type" in (select "resourceType" from selected_type)
          and (
            (document."resource_type" = 'entity' and entity."id" is not null)
            or (document."resource_type" = 'knowledge_page' and page."id" is not null)
            or (document."resource_type" = 'asset' and asset."id" is not null)
            or (document."resource_type" = 'record' and record."readable_id" is not null)
          )
          and (
            document."resource_type" <> 'knowledge_page'
            or ${pageInterval} is null
            or (${pageInterval} = 'without' and revision."temporal_coverage" is null)
            or (${pageInterval} = 'with' and revision."temporal_coverage" is not null)
          )
          and (
            document."resource_type" <> 'knowledge_page'
            or ${filterStart} is null
            or (
              revision."temporal_coverage" is not null and
              (${filterEnd} is null or revision."temporal_start_ms" < ${filterEnd})
              and (revision."temporal_end_exclusive_ms" is null
                or revision."temporal_end_exclusive_ms" > ${filterStart})
            )
          )
          and (
            document."resource_type" <> 'asset'
            or ${assetKind} is null
            or (
              asset."media_type" like 'image/%'
              and not exists (
                select 1 from "entity" assignment
                where assignment."owner_id" = asset."owner_id"
                  and assignment."image_asset_id" = asset."id"
              )
            )
          )
      `,
      ]),
    );
    const totalMatches = Number(counts[0]?.total ?? 0);
    return {
      results: rows.slice(0, boundedLimit).map(resultFrom),
      totalMatches,
      truncated: totalMatches > boundedLimit,
    };
  }

  async rebuildIndex({ ownerId }: { ownerId: string }): Promise<void> {
    await this.sql.begin(async (db) => {
      const owners = await db.FindSearchRebuildOwner`
        select "id" from "auth_user" where "id" = ${ownerId}
      `;
      if (!owners[0]) {
        throw new Error('The search rebuild owner does not exist.');
      }
      // Repair postings first so projection replacement also recovers from a damaged index.
      await db.RebuildHypermediaSearchIndex`
        insert into "hypermedia_search_fts" ("hypermedia_search_fts") values ('rebuild')
      `;
      await db.RebuildEntitySearchDocuments`
        insert into "hypermedia_search_document"
          ("owner_id", "resource_type", "readable_id", "label", "summary", "body", "metadata")
        select "owner_id", 'entity', "readable_id", "name", "description", '', ''
        from "entity" where "owner_id" = ${ownerId} and "archived_at" is null
        on conflict ("owner_id", "resource_type", "readable_id") do update set
          "label" = excluded."label", "summary" = excluded."summary",
          "body" = excluded."body", "metadata" = excluded."metadata"
      `;
      await db.RebuildAssetSearchDocuments`
        insert into "hypermedia_search_document"
          ("owner_id", "resource_type", "readable_id", "label", "summary", "body", "metadata")
        select "owner_id", 'asset', "readable_id", "name", '', '',
          trim("media_type" || ' ' || coalesce("extension", ''))
        from "asset" where "owner_id" = ${ownerId} and "archived_at" is null
        on conflict ("owner_id", "resource_type", "readable_id") do update set
          "label" = excluded."label", "summary" = excluded."summary",
          "body" = excluded."body", "metadata" = excluded."metadata"
      `;
      await db.PruneHypermediaSearchDocuments`
        with active_resource as (
          select 'entity' as "type", "readable_id" from "entity"
            where "owner_id" = ${ownerId} and "archived_at" is null
          union all select 'asset', "readable_id" from "asset"
            where "owner_id" = ${ownerId} and "archived_at" is null
          union all select 'knowledge_page', "readable_id" from "knowledge_page"
            where "owner_id" = ${ownerId} and "archived_at" is null
          union all select 'record', "readable_id" from "record"
            where "owner_id" = ${ownerId} and "operation" <> 'deleted'
        )
        delete from "hypermedia_search_document" as document
        where document."owner_id" = ${ownerId} and not exists (
          select 1 from active_resource resource
          where resource."type" = document."resource_type"
            and resource."readable_id" = document."readable_id"
        )
      `;
    });
  }

  async verifyIndex({ ownerId }: { ownerId: string }): Promise<void> {
    await this.sql.begin(async (db) => {
      const missing = await db.CountMissingMarkdownSearchDocuments`
        /* @notNull total */
        /* @type total number */
        with markdown_resource as (
          select 'knowledge_page' as "type", "readable_id" from "knowledge_page"
            where "owner_id" = ${ownerId} and "archived_at" is null
          union all select 'record', "readable_id" from "record"
            where "owner_id" = ${ownerId} and "operation" <> 'deleted'
        )
        select count(*) as "total" from markdown_resource resource
        where not exists (
          select 1 from "hypermedia_search_document" document
          where document."owner_id" = ${ownerId} and document."resource_type" = resource."type"
            and document."readable_id" = resource."readable_id"
        )
      `;
      if (Number(missing[0]?.total ?? 0) > 0) {
        throw new Error(
          'Search rebuild is incomplete; rebuild page and record text before finishing.',
        );
      }
      await db.CheckHypermediaSearchIndex`
        insert into "hypermedia_search_fts" ("hypermedia_search_fts", "rank") values ('integrity-check', 1)
      `;
    });
  }
}
