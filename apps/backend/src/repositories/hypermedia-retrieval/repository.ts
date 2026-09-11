import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type { Storage } from '#lib/storage/storage.ts';
import { readVerifiedText } from '#lib/storage/verified-text.ts';
import type {
  HypermediaResourceType,
  HypermediaRetrievalFilters,
  HypermediaRetrievalResult,
  HypermediaRetrievalResults,
} from '#models/hypermedia-retrieval/model.ts';
import { MAX_HYPERMEDIA_SEARCH_LIMIT } from '#models/hypermedia-retrieval/model.ts';
import { parseKnowledgePageMarkdown } from '#models/knowledge-pages/markdown.ts';
import type { DeliveredRecord } from '#models/records/delivery-contract.generated.ts';
import { recordSearchText } from '#models/records/search.ts';
import type { Queries } from '#queries.gen.ts';
import type { HypermediaRetrievalRepositoryContract } from './contract.ts';
import { BODY_SNIPPET_COLUMN, type SnippetDocument, searchSnippets } from './snippets.ts';

type SearchRow = Queries['SearchHypermedia'];

function queryTokens(query: string): string[] {
  return [...query.matchAll(/[\p{L}\p{N}]+/gu)].map(([token]) => token.toLowerCase());
}

function ftsQuery(query: string): string | null {
  const tokens = [...new Set(queryTokens(query))];
  return tokens.length > 0 ? tokens.map((token) => `"${token}"*`).join(' OR ') : null;
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

function resultFrom({
  row,
  excerpt,
}: {
  row: SearchRow;
  excerpt: string | null;
}): HypermediaRetrievalResult {
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
    if (
      !(
        row.recordKind &&
        row.recordTitle !== null &&
        row.recordProvider &&
        row.recordId &&
        row.syncReadableId &&
        row.syncName
      )
    ) {
      throw new Error('Hypermedia record search projection is incomplete');
    }
    return {
      resourceType: row.resourceType,
      record: {
        readableId: row.readableId,
        title: row.recordTitle,
        provider: row.recordProvider,
        participantNames: JSON.parse(row.participantNames),
        sourceCreatedAt: row.sourceCreatedAt,
        sourceUpdatedAt: row.sourceUpdatedAt,
        kind: row.recordKind,
        recordId: row.recordId,
        sync: { readableId: row.syncReadableId, name: row.syncName },
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
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

function snippetDocumentFrom(row: SearchRow): SnippetDocument {
  return {
    readableId: row.readableId,
    label: row.entityName ?? row.assetName ?? row.pageTitle ?? row.recordTitle ?? '',
    summary: row.entityDescription ?? row.pageExcerpt ?? '',
    body: '',
    metadata: [row.mediaType, row.assetExtension].filter(Boolean).join(' '),
    column: row.resourceType === 'record' ? (-1 as const) : BODY_SNIPPET_COLUMN,
  };
}

export class HypermediaRetrievalRepository implements HypermediaRetrievalRepositoryContract {
  private readonly sql: TypedSQL<Queries>;

  constructor(private readonly dependencies: { database: SQL; storage: Storage }) {
    this.sql = withTypes<Queries>(dependencies.database);
  }

  private async *snippetDocuments(rows: SearchRow[]): AsyncGenerator<SnippetDocument> {
    for (const row of rows) {
      const document = snippetDocumentFrom(row);
      if (row.resourceType !== 'knowledge_page' && row.resourceType !== 'record') {
        yield document;
        continue;
      }
      if (!(row.storageKey && row.contentHash && row.contentSizeBytes !== null)) {
        throw new Error('Search file reference is incomplete');
      }
      const text = await readVerifiedText({
        storage: this.dependencies.storage,
        storageKey: row.storageKey,
        contentHash: row.contentHash,
        sizeBytes: Number(row.contentSizeBytes),
        label: `Search resource ${row.readableId}`,
      });
      if (row.resourceType === 'knowledge_page') {
        document.body = parseKnowledgePageMarkdown(text).searchableText;
      } else {
        const record: DeliveredRecord = JSON.parse(text);
        if (record.operation === 'deleted') {
          throw new Error('An active search result references a deletion');
        }
        const projection = recordSearchText(record);
        document.body = projection.body;
        document.metadata = projection.metadata;
      }
      yield document;
    }
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
    const recordsOnly = filters?.record !== undefined;
    const provider = filters?.record?.provider ?? null;
    const recordKind = filters?.record?.kind ?? null;
    const participantName = filters?.record?.participantName ?? null;
    const boundedLimit = Math.min(Math.max(limit, 1), MAX_HYPERMEDIA_SEARCH_LIMIT);
    const [rows, counts, schemas] = await this.sql.begin((db) =>
      Promise.all([
        db.SearchHypermedia`
      /* @notNull resourceType readableId participantNames createdAt updatedAt */
      /* @type resourceType 'entity' | 'knowledge_page' | 'asset' | 'record' */
      /* @type isSelf number */
      /* @type revisionNumber number */
      /* @type storageKey string */
      /* @type contentHash string */
      /* @type contentSizeBytes number */
      /* @type createdAt string */
      /* @type updatedAt string */
      with selected_type as (
        select value as "resourceType" from json_each(${selectedTypes})
      )
      select document."resource_type" as "resourceType",
        document."readable_id" as "readableId",
        document."participant_names" as "participantNames",
        coalesce(revision."storage_key", record."storage_key") as "storageKey",
        coalesce(revision."content_hash", record."content_hash") as "contentHash",
        coalesce(revision."size_bytes", record."size_bytes") as "contentSizeBytes",
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
        record."title" as "recordTitle", record."provider" as "recordProvider",
        record."source_created_at" as "sourceCreatedAt", record."source_updated_at" as "sourceUpdatedAt",
        record."kind" as "recordKind", record."record_id" as "recordId",
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
        and (${recordsOnly} = false or document."resource_type" = 'record')
        and (${provider} is null or record."provider" = ${provider})
        and (${recordKind} is null or record."kind" = ${recordKind})
        and (${participantName} is null or exists (
          select 1 from json_each(document."participant_names") participant
          where lower(trim(participant."value")) = lower(trim(${participantName}))
        ))
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
          and (${recordsOnly} = false or document."resource_type" = 'record')
          and (${provider} is null or record."provider" = ${provider})
          and (${recordKind} is null or record."kind" = ${recordKind})
          and (${participantName} is null or exists (
            select 1 from json_each(document."participant_names") participant
            where lower(trim(participant."value")) = lower(trim(${participantName}))
          ))
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
        db.SearchSnippetSchema`
          /* @notNull sql */
          select "sql" from sqlite_schema where "name" = 'hypermedia_search_fts'
        `,
      ]),
    );
    const totalMatches = Number(counts[0]?.total ?? 0);
    if (rows.length === 0) {
      return { results: [], totalMatches, truncated: false };
    }
    if (!schemas[0]) {
      throw new Error('Search index schema is missing');
    }
    const excerpts = await searchSnippets({
      schema: schemas[0].sql,
      expression,
      documents: this.snippetDocuments(rows),
    });
    return {
      results: Array.from(rows.entries(), ([index, row]) =>
        resultFrom({ row, excerpt: excerpts[index] ?? null }),
      ),
      totalMatches,
      truncated: totalMatches > boundedLimit,
    };
  }
}
