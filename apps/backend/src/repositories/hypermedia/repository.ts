import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type {
  HypermediaPage,
  HypermediaPages,
  HypermediaResource,
  HypermediaResourceContinuation,
  HypermediaResourceKind,
  HypermediaResourceNeighborhood,
  HypermediaResourceReference,
  HypermediaRetrievalMatches,
} from '#models/hypermedia/model.ts';
import type { KnowledgePageSummary } from '#models/knowledge-pages/model.ts';
import type { TemporalBounds } from '#models/knowledge-pages/temporal-coverage.ts';
import type {
  IListHypermediaPageResourcesResult,
  IListHypermediaPagesResult,
  Queries,
} from '#queries.gen.ts';

const MAX_HYPERMEDIA_PAGE_RESOURCE_REFERENCES = 120;

type ResourceRow = {
  kind: HypermediaResourceKind;
  id: string;
  readableId: string;
  name: string;
  description: string | null;
  isSelf: number;
  imageId: string | null;
  imageReadableId: string | null;
  imageName: string | null;
  imageMediaType: string | null;
  imageExtension: string | null;
  imageSizeBytes: number | null;
  imageCreatedAt: string | null;
  imageUpdatedAt: string | null;
  mediaType: string | null;
  extension: string | null;
  sizeBytes: number | null;
  createdAt: string;
  updatedAt: string;
};

function resourceFrom(row: ResourceRow): HypermediaResource {
  if (row.kind === 'asset') {
    if (!row.mediaType || row.sizeBytes === null) {
      throw new Error('Hypermedia asset projection is incomplete');
    }
    return {
      kind: 'asset',
      asset: {
        id: row.id,
        readableId: row.readableId,
        name: row.name,
        mediaType: row.mediaType,
        extension: row.extension,
        sizeBytes: Number(row.sizeBytes),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    };
  }
  if (row.description === null) {
    throw new Error('Hypermedia entity projection is incomplete');
  }
  return {
    kind: 'entity',
    entity: {
      id: row.id,
      readableId: row.readableId,
      name: row.name,
      description: row.description,
      isSelf: Boolean(row.isSelf),
      image:
        row.imageId &&
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
          : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  };
}

type PageRow = {
  id: string;
  readableId: string;
  revisionNumber: number;
  title: string;
  excerpt: string;
  temporalCoverage: string | null;
  createdAt: string;
  updatedAt: string;
};

function pageSummaryFrom(row: PageRow): KnowledgePageSummary {
  return { ...row, revisionNumber: Number(row.revisionNumber) };
}

function resourceCursorParameters(cursor?: HypermediaResourceContinuation) {
  return {
    cursorSharedPageCount: cursor?.sharedPageCount ?? null,
    cursorKind: cursor?.kind ?? null,
    cursorReadableId: cursor?.readableId ?? null,
  };
}

export interface HypermediaRepositoryContract {
  resourceNeighborhood(input: {
    ownerId: string;
    anchor: HypermediaResourceReference;
    kinds: HypermediaResourceKind[];
    limit: number;
    cursor?: HypermediaResourceContinuation;
  }): Promise<HypermediaResourceNeighborhood | null>;
  pages(input: {
    ownerId: string;
    resources: HypermediaResourceReference[];
    visibleResources: HypermediaResourceReference[];
    kinds: HypermediaResourceKind[];
    limit: number;
    offset: number;
    retrievalMatches?: HypermediaRetrievalMatches;
    temporalBounds?: TemporalBounds;
  }): Promise<HypermediaPages>;
}

export class HypermediaRepository implements HypermediaRepositoryContract {
  private readonly sql: TypedSQL<Queries>;

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  async resourceNeighborhood({
    ownerId,
    anchor,
    kinds,
    limit,
    cursor,
  }: {
    ownerId: string;
    anchor: HypermediaResourceReference;
    kinds: HypermediaResourceKind[];
    limit: number;
    cursor?: HypermediaResourceContinuation;
  }): Promise<HypermediaResourceNeighborhood | null> {
    const resourceKinds = JSON.stringify(kinds);
    const { cursorSharedPageCount, cursorKind, cursorReadableId } =
      resourceCursorParameters(cursor);
    const rowLimit = limit + 1;
    const [anchorRows, neighborRows] = await Promise.all([
      this.sql.FindHypermediaResource`
        /* @notNull kind id readableId name isSelf createdAt updatedAt */
        /* @type kind 'entity' | 'asset' */
        /* @type isSelf number */
        /* @type name string */
        /* @type createdAt string */
        /* @type updatedAt string */
        with requested_resource as (
          select 'entity' as "kind", entity."id", entity."readable_id" as "readableId"
          from "entity" entity
          where ${anchor.kind} = 'entity' and entity."owner_id" = ${ownerId}
            and entity."readable_id" = ${anchor.readableId} and entity."archived_at" is null
          union all
          select 'asset' as "kind", asset."id", asset."readable_id" as "readableId"
          from "asset" asset
          where ${anchor.kind} = 'asset' and asset."owner_id" = ${ownerId}
            and asset."readable_id" = ${anchor.readableId} and asset."archived_at" is null
        )
        select requested_resource."kind", requested_resource."id",
          requested_resource."readableId",
          case when requested_resource."kind" = 'entity' then entity."name" else asset."name" end
            as "name",
          entity."description", coalesce(profile."self_entity_id" is not null, 0) as "isSelf",
          image."id" as "imageId", image."readable_id" as "imageReadableId",
          image."name" as "imageName", image."media_type" as "imageMediaType",
          image."extension" as "imageExtension", image."size_bytes" as "imageSizeBytes",
          image."created_at" as "imageCreatedAt", image."updated_at" as "imageUpdatedAt",
          asset."media_type" as "mediaType", asset."extension", asset."size_bytes" as "sizeBytes",
          case when requested_resource."kind" = 'entity'
            then entity."created_at" else asset."created_at" end as "createdAt",
          case when requested_resource."kind" = 'entity'
            then entity."updated_at" else asset."updated_at" end as "updatedAt"
        from requested_resource
        left join "entity" entity
          on requested_resource."kind" = 'entity' and entity."id" = requested_resource."id"
         and entity."owner_id" = ${ownerId}
        left join "knowledge_profile" profile
          on profile."owner_id" = entity."owner_id" and profile."self_entity_id" = entity."id"
        left join "asset" image
          on image."owner_id" = entity."owner_id" and image."id" = entity."image_asset_id"
         and image."archived_at" is null
        left join "asset" asset
          on requested_resource."kind" = 'asset' and asset."id" = requested_resource."id"
         and asset."owner_id" = ${ownerId}
      `,
      this.sql.ListHypermediaResourceNeighbors`
        /* @notNull kind id readableId name isSelf createdAt updatedAt sharedPageCount */
        /* @type kind 'entity' | 'asset' */
        /* @type isSelf number */
        /* @type sharedPageCount number */
        /* @type name string */
        /* @type createdAt string */
        /* @type updatedAt string */
        with selected_kind as (
          select value as "kind" from json_each(${resourceKinds})
        ), anchor_revision as (
          select mention."source_revision_id" as "revisionId"
          from "entity" anchor_entity
          join "knowledge_page_entity_mention" mention
            on mention."owner_id" = anchor_entity."owner_id"
           and mention."target_entity_id" = anchor_entity."id"
          join "knowledge_page" page
            on page."owner_id" = mention."owner_id"
           and page."current_revision_id" = mention."source_revision_id"
           and page."archived_at" is null
          where ${anchor.kind} = 'entity' and anchor_entity."owner_id" = ${ownerId}
            and anchor_entity."readable_id" = ${anchor.readableId}
            and anchor_entity."archived_at" is null
          union
          select usage."source_revision_id" as "revisionId"
          from "asset" anchor_asset
          join "knowledge_page_asset_usage" usage
            on usage."owner_id" = anchor_asset."owner_id"
           and usage."target_asset_id" = anchor_asset."id"
          join "knowledge_page" page
            on page."owner_id" = usage."owner_id"
           and page."current_revision_id" = usage."source_revision_id"
           and page."archived_at" is null
          where ${anchor.kind} = 'asset' and anchor_asset."owner_id" = ${ownerId}
            and anchor_asset."readable_id" = ${anchor.readableId}
            and anchor_asset."archived_at" is null
        ), candidate as (
          select 'entity' as "kind", entity."id" as "resourceId",
            entity."readable_id" as "readableId",
            count(distinct anchor_revision."revisionId") as "sharedPageCount"
          from anchor_revision
          join "knowledge_page_entity_mention" mention
            on mention."owner_id" = ${ownerId}
           and mention."source_revision_id" = anchor_revision."revisionId"
          join "entity" entity
            on entity."owner_id" = mention."owner_id"
           and entity."id" = mention."target_entity_id"
          where entity."archived_at" is null
            and 'entity' in (select "kind" from selected_kind)
            and not (${anchor.kind} = 'entity' and entity."readable_id" = ${anchor.readableId})
          group by entity."id", entity."readable_id"
          union all
          select 'asset' as "kind", asset."id" as "resourceId",
            asset."readable_id" as "readableId",
            count(distinct anchor_revision."revisionId") as "sharedPageCount"
          from anchor_revision
          join "knowledge_page_asset_usage" usage
            on usage."owner_id" = ${ownerId}
           and usage."source_revision_id" = anchor_revision."revisionId"
          join "asset" asset
            on asset."owner_id" = usage."owner_id" and asset."id" = usage."target_asset_id"
          where asset."archived_at" is null
            and 'asset' in (select "kind" from selected_kind)
            and not (${anchor.kind} = 'asset' and asset."readable_id" = ${anchor.readableId})
          group by asset."id", asset."readable_id"
        )
        select candidate."kind", candidate."resourceId" as "id", candidate."readableId",
          case when candidate."kind" = 'entity' then entity."name" else asset."name" end as "name",
          entity."description", coalesce(profile."self_entity_id" is not null, 0) as "isSelf",
          image."id" as "imageId", image."readable_id" as "imageReadableId",
          image."name" as "imageName", image."media_type" as "imageMediaType",
          image."extension" as "imageExtension", image."size_bytes" as "imageSizeBytes",
          image."created_at" as "imageCreatedAt", image."updated_at" as "imageUpdatedAt",
          asset."media_type" as "mediaType", asset."extension", asset."size_bytes" as "sizeBytes",
          case when candidate."kind" = 'entity'
            then entity."created_at" else asset."created_at" end as "createdAt",
          case when candidate."kind" = 'entity'
            then entity."updated_at" else asset."updated_at" end as "updatedAt",
          candidate."sharedPageCount"
        from candidate
        left join "entity" entity
          on candidate."kind" = 'entity' and entity."id" = candidate."resourceId"
         and entity."owner_id" = ${ownerId}
        left join "knowledge_profile" profile
          on profile."owner_id" = entity."owner_id" and profile."self_entity_id" = entity."id"
        left join "asset" image
          on image."owner_id" = entity."owner_id" and image."id" = entity."image_asset_id"
         and image."archived_at" is null
        left join "asset" asset
          on candidate."kind" = 'asset' and asset."id" = candidate."resourceId"
         and asset."owner_id" = ${ownerId}
        where ${cursorSharedPageCount} is null
          or candidate."sharedPageCount" < ${cursorSharedPageCount}
          or (candidate."sharedPageCount" = ${cursorSharedPageCount}
            and candidate."kind" > ${cursorKind})
          or (candidate."sharedPageCount" = ${cursorSharedPageCount}
            and candidate."kind" = ${cursorKind} and candidate."readableId" > ${cursorReadableId})
        order by candidate."sharedPageCount" desc, candidate."kind", candidate."readableId"
        limit ${rowLimit}
      `,
    ]);
    const anchorRow = anchorRows[0];
    if (!anchorRow) {
      return null;
    }
    const selectedRows = neighborRows.slice(0, limit);
    const lastRow = selectedRows.at(-1);
    return {
      anchor: resourceFrom(anchorRow),
      neighbors: selectedRows.map((row) => ({
        resource: resourceFrom(row),
        sharedPageCount: Number(row.sharedPageCount),
      })),
      nextPage:
        neighborRows.length > limit && lastRow
          ? {
              sharedPageCount: Number(lastRow.sharedPageCount),
              kind: lastRow.kind,
              readableId: lastRow.readableId,
            }
          : null,
    };
  }

  async pages({
    ownerId,
    resources,
    visibleResources,
    kinds,
    limit,
    offset,
    retrievalMatches,
    temporalBounds,
  }: {
    ownerId: string;
    resources: HypermediaResourceReference[];
    visibleResources: HypermediaResourceReference[];
    kinds: HypermediaResourceKind[];
    limit: number;
    offset: number;
    retrievalMatches?: HypermediaRetrievalMatches;
    temporalBounds?: TemporalBounds;
  }): Promise<HypermediaPages> {
    const selectedResourceKeys = JSON.stringify(
      resources.map(({ kind, readableId }) => `${kind}:${readableId}`),
    );
    const visibleResourceKeys = JSON.stringify(
      visibleResources.map(({ kind, readableId }) => `${kind}:${readableId}`),
    );
    const scopedResources = new Map(
      [...resources, ...visibleResources].map((resource) => [
        `${resource.kind}:${resource.readableId}`,
        resource,
      ]),
    );
    const scopedResourceKeys = JSON.stringify([...scopedResources.keys()]);
    const selectedResourceCount = resources.length;
    const visibleResourceCount = visibleResources.length;
    const visibleScopedResourceCount = [...scopedResources.values()].filter(({ kind }) =>
      kinds.includes(kind),
    ).length;
    const resourceKinds = JSON.stringify(kinds);
    const retrievalPageReadableIds = JSON.stringify(retrievalMatches?.pageReadableIds ?? []);
    const retrievalResourceKeys = JSON.stringify(
      retrievalMatches?.resources.map(({ kind, readableId }) => `${kind}:${readableId}`) ?? [],
    );
    const searchApplied = retrievalMatches ? 1 : 0;
    const filterStart = temporalBounds?.start ?? null;
    const filterEnd = temporalBounds?.end ?? null;
    const rowLimit = limit + 1;
    const pageRows = await this.matchingPageRows({
      ownerId,
      selectedResourceKeys,
      selectedResourceCount,
      visibleResourceKeys,
      visibleResourceCount,
      retrievalPageReadableIds,
      retrievalResourceKeys,
      searchApplied,
      filterStart,
      filterEnd,
      rowLimit,
      offset,
    });
    const selectedPageRows = pageRows.slice(0, limit);
    const pages = selectedPageRows.map(
      (row): HypermediaPage => ({ ...pageSummaryFrom(row), resources: [] }),
    );
    if (pages.length === 0) {
      return {
        pages,
        nextOffset: pageRows.length > limit ? offset + limit : null,
        resourceReferencesTruncated: false,
      };
    }
    const selectedPageIds = JSON.stringify(selectedPageRows.map(({ id }) => id));
    const maximumScopedResourceReferences = visibleScopedResourceCount * selectedPageRows.length;
    const referenceLimit =
      MAX_HYPERMEDIA_PAGE_RESOURCE_REFERENCES + maximumScopedResourceReferences + 1;
    const referenceRows = await this.pageResourceRows({
      ownerId,
      resourceKinds,
      resourceKeys: scopedResourceKeys,
      selectedPageIds,
      referenceLimit,
      retrievalResourceKeys,
      searchApplied,
    });
    const pagesById = new Map(pages.map((page) => [page.readableId, page]));
    const returnedReferenceLimit = referenceLimit - 1;
    for (const row of referenceRows.slice(0, returnedReferenceLimit)) {
      pagesById.get(row.sourcePageReadableId)?.resources.push({
        kind: row.kind,
        readableId: row.readableId,
      });
    }
    return {
      pages,
      nextOffset: pageRows.length > limit ? offset + limit : null,
      resourceReferencesTruncated: referenceRows.length > returnedReferenceLimit,
    };
  }

  private matchingPageRows({
    ownerId,
    selectedResourceKeys,
    selectedResourceCount,
    visibleResourceKeys,
    visibleResourceCount,
    retrievalPageReadableIds,
    retrievalResourceKeys,
    searchApplied,
    filterStart,
    filterEnd,
    rowLimit,
    offset,
  }: {
    ownerId: string;
    selectedResourceKeys: string;
    selectedResourceCount: number;
    visibleResourceKeys: string;
    visibleResourceCount: number;
    retrievalPageReadableIds: string;
    retrievalResourceKeys: string;
    searchApplied: number;
    filterStart: number | null;
    filterEnd: number | null;
    rowLimit: number;
    offset: number;
  }): Promise<IListHypermediaPagesResult[]> {
    return this.sql.ListHypermediaPages`
      /* @notNull id readableId revisionNumber title excerpt ongoingSort createdAt updatedAt */
      /* @type ongoingSort number */
      with selected_key as (
        select value as "key" from json_each(${selectedResourceKeys})
      ), visible_key as (
        select value as "key" from json_each(${visibleResourceKeys})
      ), retrieval_page as (
        select value as "readableId" from json_each(${retrievalPageReadableIds})
      ), retrieval_resource as (
        select value as "key" from json_each(${retrievalResourceKeys})
      ), active_resource_reference as (
        select mention."source_revision_id" as "revisionId",
          'entity:' || entity."readable_id" as "key"
        from "knowledge_page_entity_mention" mention
        join "entity" entity
          on entity."owner_id" = mention."owner_id" and entity."id" = mention."target_entity_id"
        where mention."owner_id" = ${ownerId} and entity."archived_at" is null
        union
        select usage."source_revision_id" as "revisionId",
          'asset:' || asset."readable_id" as "key"
        from "knowledge_page_asset_usage" usage
        join "asset" asset
          on asset."owner_id" = usage."owner_id" and asset."id" = usage."target_asset_id"
        where usage."owner_id" = ${ownerId} and asset."archived_at" is null
      ), resource_matched_revision as (
        select reference."revisionId"
        from active_resource_reference reference
        left join selected_key selected on selected."key" = reference."key"
        left join visible_key visible on visible."key" = reference."key"
        group by reference."revisionId"
        having (
          ${selectedResourceCount} = 0
          or count(distinct selected."key") = ${selectedResourceCount}
        ) and (${visibleResourceCount} = 0 or count(distinct visible."key") > 0)
      ), retrieval_matched_revision as (
        select page."current_revision_id" as "revisionId"
        from "knowledge_page" page
        where page."owner_id" = ${ownerId} and page."archived_at" is null
          and page."readable_id" in (select "readableId" from retrieval_page)
        union
        select mention."source_revision_id" as "revisionId"
        from "knowledge_page_entity_mention" mention
        join "entity" entity
          on entity."owner_id" = mention."owner_id" and entity."id" = mention."target_entity_id"
        where mention."owner_id" = ${ownerId} and entity."archived_at" is null
          and 'entity:' || entity."readable_id" in (select "key" from retrieval_resource)
        union
        select usage."source_revision_id" as "revisionId"
        from "knowledge_page_asset_usage" usage
        join "asset" asset
          on asset."owner_id" = usage."owner_id" and asset."id" = usage."target_asset_id"
        where usage."owner_id" = ${ownerId} and asset."archived_at" is null
          and 'asset:' || asset."readable_id" in (select "key" from retrieval_resource)
      ), filtered_page as (
        select page."id", page."readable_id" as "readableId",
          revision."revision_number" as "revisionNumber", revision."title", revision."excerpt",
          revision."temporal_coverage" as "temporalCoverage",
          revision."temporal_coverage" is not null
            and revision."temporal_end_exclusive_ms" is null as "ongoingSort",
          case when revision."temporal_coverage" is not null
            then coalesce(revision."temporal_end_exclusive_ms", revision."temporal_start_ms")
          end as "latestSort",
          case when revision."temporal_coverage" is not null
            then revision."temporal_start_ms"
          end as "startSort",
          page."created_at" as "createdAt", page."updated_at" as "updatedAt"
        from "knowledge_page" page
        join "knowledge_page_revision" revision
          on revision."id" = page."current_revision_id" and revision."owner_id" = page."owner_id"
        where page."owner_id" = ${ownerId} and page."archived_at" is null
          and page."current_revision_id" in (select "revisionId" from resource_matched_revision)
          and (${searchApplied} = 0
            or page."current_revision_id" in (select "revisionId" from retrieval_matched_revision))
          and (
            (${filterStart} is null and revision."temporal_coverage" is null)
            or (
              ${filterStart} is not null and revision."temporal_coverage" is not null
              and (${filterEnd} is null or revision."temporal_start_ms" < ${filterEnd})
              and (revision."temporal_end_exclusive_ms" is null
                or revision."temporal_end_exclusive_ms" > ${filterStart})
            )
          )
      )
      select * from filtered_page
      order by "ongoingSort" desc, "latestSort" desc, "startSort" desc,
        "updatedAt" desc, "readableId"
      limit ${rowLimit}
      offset ${offset}
    `;
  }

  private pageResourceRows({
    ownerId,
    resourceKinds,
    resourceKeys,
    selectedPageIds,
    referenceLimit,
    retrievalResourceKeys,
    searchApplied,
  }: {
    ownerId: string;
    resourceKinds: string;
    resourceKeys: string;
    selectedPageIds: string;
    referenceLimit: number;
    retrievalResourceKeys: string;
    searchApplied: number;
  }): Promise<IListHypermediaPageResourcesResult[]> {
    return this.sql.ListHypermediaPageResources`
      /* @notNull sourcePageReadableId kind readableId */
      /* @type kind 'entity' | 'asset' */
      with selected_kind as (
        select value as "kind" from json_each(${resourceKinds})
      ), selected_key as (
        select value as "key" from json_each(${resourceKeys})
      ), retrieval_resource as (
        select value as "key" from json_each(${retrievalResourceKeys})
      ), selected_page as (
        select "id", "readable_id" as "readableId", "current_revision_id" as "revisionId"
        from "knowledge_page"
        where "owner_id" = ${ownerId} and "archived_at" is null
          and "id" in (select value from json_each(${selectedPageIds}))
      ), page_resource as (
        select selected_page."readableId" as "sourcePageReadableId", 'entity' as "kind",
          entity."readable_id" as "readableId"
        from selected_page
        join "knowledge_page_entity_mention" mention
          on mention."owner_id" = ${ownerId}
         and mention."source_revision_id" = selected_page."revisionId"
        join "entity" entity
          on entity."owner_id" = mention."owner_id" and entity."id" = mention."target_entity_id"
        where entity."archived_at" is null
          and 'entity' in (select "kind" from selected_kind)
          and (${searchApplied} = 0
            or 'entity:' || entity."readable_id" in (select "key" from retrieval_resource))
        union
        select selected_page."readableId" as "sourcePageReadableId", 'asset' as "kind",
          asset."readable_id" as "readableId"
        from selected_page
        join "knowledge_page_asset_usage" usage
          on usage."owner_id" = ${ownerId}
         and usage."source_revision_id" = selected_page."revisionId"
        join "asset" asset
          on asset."owner_id" = usage."owner_id" and asset."id" = usage."target_asset_id"
        where asset."archived_at" is null
          and 'asset' in (select "kind" from selected_kind)
          and (${searchApplied} = 0
            or 'asset:' || asset."readable_id" in (select "key" from retrieval_resource))
      )
      select "sourcePageReadableId", "kind", "readableId" from page_resource
      order by ("kind" || ':' || "readableId") in (select "key" from selected_key) desc,
        row_number() over (
        partition by "sourcePageReadableId" order by "kind", "readableId"
      ), "sourcePageReadableId"
      limit ${referenceLimit}
    `;
  }
}
