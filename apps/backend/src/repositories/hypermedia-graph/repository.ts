import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type {
  HypermediaEntityReference,
  HypermediaNeighborhoods,
  HypermediaPage,
  HypermediaPages,
  HypermediaRetrievalMatches,
} from '#models/hypermedia-graph/model.ts';
import { MAX_HYPERMEDIA_EXTRA_RELATIONSHIPS } from '#models/hypermedia-graph/model.ts';
import type { KnowledgePageSummary } from '#models/knowledge-pages/model.ts';
import type { TemporalBounds } from '#models/knowledge-pages/temporal-coverage.ts';
import type {
  IListHypermediaPageEntitiesResult,
  IListHypermediaPagesResult,
  Queries,
} from '#queries.gen.ts';
import type { HypermediaGraphRepositoryContract } from './contract.ts';
import { neighborhoodsFromRows } from './neighborhoods.ts';

const MAX_HYPERMEDIA_PAGE_ENTITY_REFERENCES = 120;

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

export class HypermediaGraphRepository implements HypermediaGraphRepositoryContract {
  private readonly sql: TypedSQL<Queries>;

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  async neighborhoods({
    ownerId,
    anchors,
    limit,
  }: Parameters<
    HypermediaGraphRepositoryContract['neighborhoods']
  >[0]): Promise<HypermediaNeighborhoods> {
    const requests = JSON.stringify(
      anchors.map(({ anchor, cursor }) => ({
        readableId: anchor.readableId,
        cursorSharedPageCount: cursor?.sharedPageCount ?? null,
        cursorReadableId: cursor?.readableId ?? null,
      })),
    );
    const rowLimit = limit + 1;
    const extraLimit = MAX_HYPERMEDIA_EXTRA_RELATIONSHIPS + 1;
    // One statement keeps ranks, entity projections and induced relationships in the same snapshot.
    const rows = await this.sql.ListHypermediaNeighborhoods`
      /* @notNull rowType sourceReadableId sharedPageCount position id readableId name description isSelf createdAt updatedAt */
      /* @type rowType 'anchor' | 'neighbor' | 'relationship' */
      /* @type isSelf number */
      /* @type sharedPageCount number */
      /* @type position number */
      with requested as (
        select json_extract(value, '$.readableId') as "readableId",
          json_extract(value, '$.cursorSharedPageCount') as "cursorSharedPageCount",
          json_extract(value, '$.cursorReadableId') as "cursorReadableId"
        from json_each(${requests})
      ), anchor as (
        select entity."id", entity."readable_id" as "readableId",
          requested."cursorSharedPageCount", requested."cursorReadableId"
        from requested
        join "entity" entity on entity."readable_id" = requested."readableId"
        where entity."owner_id" = ${ownerId} and entity."archived_at" is null
      ), anchor_revision as (
        select anchor."readableId" as "anchorReadableId", mention."source_revision_id" as "revisionId"
        from anchor
        join "knowledge_page_entity_mention" mention
          on mention."owner_id" = ${ownerId} and mention."target_entity_id" = anchor."id"
        join "knowledge_page" page
          on page."owner_id" = mention."owner_id"
          and page."current_revision_id" = mention."source_revision_id" and page."archived_at" is null
      ), candidate as (
        select anchor_revision."anchorReadableId", entity."readable_id" as "readableId",
          count(distinct anchor_revision."revisionId") as "sharedPageCount"
        from anchor_revision
        join "knowledge_page_entity_mention" mention
          on mention."owner_id" = ${ownerId} and mention."source_revision_id" = anchor_revision."revisionId"
        join "entity" entity
          on entity."owner_id" = mention."owner_id" and entity."id" = mention."target_entity_id"
        where entity."archived_at" is null and entity."readable_id" != anchor_revision."anchorReadableId"
        group by anchor_revision."anchorReadableId", entity."readable_id"
      ), ranked_neighbor as (
        select candidate.*, row_number() over (
          partition by candidate."anchorReadableId"
          order by candidate."sharedPageCount" desc, candidate."readableId"
        ) as "position"
        from candidate
        join anchor on anchor."readableId" = candidate."anchorReadableId"
        where anchor."cursorSharedPageCount" is null
          or candidate."sharedPageCount" < anchor."cursorSharedPageCount"
          or (candidate."sharedPageCount" = anchor."cursorSharedPageCount"
            and candidate."readableId" > anchor."cursorReadableId")
      ), returned_neighbor as (
        select * from ranked_neighbor where "position" <= ${limit}
      ), selected_entity as (
        select entity."id", entity."readable_id" as "readableId"
        from "entity" entity
        where entity."owner_id" = ${ownerId} and entity."archived_at" is null
          and entity."readable_id" in (
            select "readableId" from anchor union select "readableId" from returned_neighbor
          )
      ), extra_relationship as (
        select source."readableId" as "sourceReadableId", target."readableId" as "readableId",
          count(distinct first_mention."source_revision_id") as "sharedPageCount"
        from selected_entity source
        join "knowledge_page_entity_mention" first_mention
          on first_mention."owner_id" = ${ownerId} and first_mention."target_entity_id" = source."id"
        join "knowledge_page" page
          on page."owner_id" = first_mention."owner_id"
          and page."current_revision_id" = first_mention."source_revision_id" and page."archived_at" is null
        join "knowledge_page_entity_mention" second_mention
          on second_mention."owner_id" = first_mention."owner_id"
          and second_mention."source_revision_id" = first_mention."source_revision_id"
        join selected_entity target on target."id" = second_mention."target_entity_id"
          and source."readableId" < target."readableId"
        where not exists (
          select 1 from returned_neighbor neighbor
          where (neighbor."anchorReadableId" = source."readableId" and neighbor."readableId" = target."readableId")
            or (neighbor."anchorReadableId" = target."readableId" and neighbor."readableId" = source."readableId")
        )
        group by source."readableId", target."readableId"
        order by "sharedPageCount" desc, source."readableId", target."readableId"
        limit ${extraLimit}
      ), graph_row as (
        select 'anchor' as "rowType", "readableId" as "sourceReadableId", "readableId",
          0 as "sharedPageCount", 0 as "position" from anchor
        union all
        select 'neighbor', "anchorReadableId", "readableId", "sharedPageCount", "position"
          from ranked_neighbor where "position" <= ${rowLimit}
        union all
        select 'relationship', "sourceReadableId", "readableId", "sharedPageCount",
          row_number() over (order by "sharedPageCount" desc, "sourceReadableId", "readableId")
          from extra_relationship
      )
      select graph_row."rowType", graph_row."sourceReadableId", graph_row."sharedPageCount", graph_row."position",
        entity."id", entity."readable_id" as "readableId", entity."name",
        entity."description", entity."entity_type" as "entityType",
        coalesce(profile."self_entity_id" is not null, 0) as "isSelf",
        image."id" as "imageId", image."readable_id" as "imageReadableId",
        image."name" as "imageName", image."media_type" as "imageMediaType",
        image."extension" as "imageExtension", image."size_bytes" as "imageSizeBytes",
        image."created_at" as "imageCreatedAt", image."updated_at" as "imageUpdatedAt",
        entity."created_at" as "createdAt", entity."updated_at" as "updatedAt"
      from graph_row
      join "entity" entity on entity."owner_id" = ${ownerId} and entity."readable_id" = graph_row."readableId"
      left join "knowledge_profile" profile
        on profile."owner_id" = entity."owner_id" and profile."self_entity_id" = entity."id"
      left join "asset" image
        on image."owner_id" = entity."owner_id" and image."id" = entity."image_asset_id" and image."archived_at" is null
      order by graph_row."rowType", graph_row."sourceReadableId", graph_row."position"
    `;
    return neighborhoodsFromRows({ rows, anchors, limit });
  }

  async pages({
    ownerId,
    entities,
    visibleEntities,
    limit,
    offset,
    retrievalMatches,
    temporalBounds,
  }: {
    ownerId: string;
    entities: HypermediaEntityReference[];
    visibleEntities: HypermediaEntityReference[];
    limit: number;
    offset: number;
    retrievalMatches?: HypermediaRetrievalMatches;
    temporalBounds?: TemporalBounds;
  }): Promise<HypermediaPages> {
    const selectedEntityKeys = JSON.stringify(entities.map(({ readableId }) => readableId));
    const visibleEntityKeys = JSON.stringify(visibleEntities.map(({ readableId }) => readableId));
    const scopedEntities = new Map(
      [...entities, ...visibleEntities].map((entity) => [entity.readableId, entity]),
    );
    const scopedEntityKeys = JSON.stringify([...scopedEntities.keys()]);
    const selectedEntityCount = entities.length;
    const visibleEntityCount = visibleEntities.length;
    const visibleScopedEntityCount = scopedEntities.size;
    const retrievalPageReadableIds = JSON.stringify(retrievalMatches?.pageReadableIds ?? []);
    const retrievalEntityKeys = JSON.stringify(
      retrievalMatches?.entities.map(({ readableId }) => readableId) ?? [],
    );
    const searchApplied = retrievalMatches ? 1 : 0;
    const filterStart = temporalBounds?.start ?? null;
    const filterEnd = temporalBounds?.end ?? null;
    const rowLimit = limit + 1;
    const pageRows = await this.matchingPageRows({
      ownerId,
      selectedEntityKeys,
      selectedEntityCount,
      visibleEntityKeys,
      visibleEntityCount,
      retrievalPageReadableIds,
      retrievalEntityKeys,
      searchApplied,
      filterStart,
      filterEnd,
      rowLimit,
      offset,
    });
    const selectedPageRows = pageRows.slice(0, limit);
    const pages = selectedPageRows.map(
      (row): HypermediaPage => ({ ...pageSummaryFrom(row), entities: [] }),
    );
    if (pages.length === 0) {
      return {
        pages,
        nextOffset: pageRows.length > limit ? offset + limit : null,
        entityReferencesTruncated: false,
      };
    }
    const selectedPageIds = JSON.stringify(selectedPageRows.map(({ id }) => id));
    const maximumScopedEntityReferences = visibleScopedEntityCount * selectedPageRows.length;
    const referenceLimit =
      MAX_HYPERMEDIA_PAGE_ENTITY_REFERENCES + maximumScopedEntityReferences + 1;
    const referenceRows = await this.pageEntityRows({
      ownerId,
      entityKeys: scopedEntityKeys,
      selectedPageIds,
      referenceLimit,
      retrievalEntityKeys,
      searchApplied,
    });
    const pagesById = new Map(pages.map((page) => [page.readableId, page]));
    const returnedReferenceLimit = referenceLimit - 1;
    for (const row of referenceRows.slice(0, returnedReferenceLimit)) {
      pagesById.get(row.sourcePageReadableId)?.entities.push({
        readableId: row.readableId,
      });
    }
    return {
      pages,
      nextOffset: pageRows.length > limit ? offset + limit : null,
      entityReferencesTruncated: referenceRows.length > returnedReferenceLimit,
    };
  }

  private matchingPageRows({
    ownerId,
    selectedEntityKeys,
    selectedEntityCount,
    visibleEntityKeys,
    visibleEntityCount,
    retrievalPageReadableIds,
    retrievalEntityKeys,
    searchApplied,
    filterStart,
    filterEnd,
    rowLimit,
    offset,
  }: {
    ownerId: string;
    selectedEntityKeys: string;
    selectedEntityCount: number;
    visibleEntityKeys: string;
    visibleEntityCount: number;
    retrievalPageReadableIds: string;
    retrievalEntityKeys: string;
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
        select value as "key" from json_each(${selectedEntityKeys})
      ), visible_key as (
        select value as "key" from json_each(${visibleEntityKeys})
      ), retrieval_page as (
        select value as "readableId" from json_each(${retrievalPageReadableIds})
      ), retrieval_entity as (
        select value as "key" from json_each(${retrievalEntityKeys})
      ), active_entity_reference as (
        select mention."source_revision_id" as "revisionId",
          entity."readable_id" as "key"
        from "knowledge_page_entity_mention" mention
        join "entity" entity
          on entity."owner_id" = mention."owner_id" and entity."id" = mention."target_entity_id"
        where mention."owner_id" = ${ownerId} and entity."archived_at" is null
      ), entity_matched_revision as (
        select reference."revisionId"
        from active_entity_reference reference
        left join selected_key selected on selected."key" = reference."key"
        left join visible_key visible on visible."key" = reference."key"
        group by reference."revisionId"
        having (
          ${selectedEntityCount} = 0
          or count(distinct selected."key") = ${selectedEntityCount}
        ) and (${visibleEntityCount} = 0 or count(distinct visible."key") > 0)
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
          and entity."readable_id" in (select "key" from retrieval_entity)
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
          and page."current_revision_id" in (select "revisionId" from entity_matched_revision)
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

  private pageEntityRows({
    ownerId,
    entityKeys,
    selectedPageIds,
    referenceLimit,
    retrievalEntityKeys,
    searchApplied,
  }: {
    ownerId: string;
    entityKeys: string;
    selectedPageIds: string;
    referenceLimit: number;
    retrievalEntityKeys: string;
    searchApplied: number;
  }): Promise<IListHypermediaPageEntitiesResult[]> {
    return this.sql.ListHypermediaPageEntities`
      /* @notNull sourcePageReadableId readableId */
      with selected_key as (
        select value as "key" from json_each(${entityKeys})
      ), retrieval_entity as (
        select value as "key" from json_each(${retrievalEntityKeys})
      ), selected_page as (
        select "id", "readable_id" as "readableId", "current_revision_id" as "revisionId"
        from "knowledge_page"
        where "owner_id" = ${ownerId} and "archived_at" is null
          and "id" in (select value from json_each(${selectedPageIds}))
      ), page_entity as (
        select selected_page."readableId" as "sourcePageReadableId",
          entity."readable_id" as "readableId"
        from selected_page
        join "knowledge_page_entity_mention" mention
          on mention."owner_id" = ${ownerId}
         and mention."source_revision_id" = selected_page."revisionId"
        join "entity" entity
          on entity."owner_id" = mention."owner_id" and entity."id" = mention."target_entity_id"
        where entity."archived_at" is null
          and (${searchApplied} = 0
            or entity."readable_id" in (select "key" from retrieval_entity))
      )
      select "sourcePageReadableId", "readableId" from page_entity
      order by "readableId" in (select "key" from selected_key) desc,
        row_number() over (
        partition by "sourcePageReadableId" order by "readableId"
      ), "sourcePageReadableId"
      limit ${referenceLimit}
    `;
  }
}
