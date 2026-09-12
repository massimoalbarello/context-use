import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type {
  HypermediaEntityContinuation,
  HypermediaEntityNeighborhood,
  HypermediaEntityReference,
  HypermediaPage,
  HypermediaPages,
  HypermediaRetrievalMatches,
} from '#models/hypermedia/model.ts';
import type { KnowledgePageSummary } from '#models/knowledge-pages/model.ts';
import type { TemporalBounds } from '#models/knowledge-pages/temporal-coverage.ts';
import type {
  IListHypermediaPageEntitiesResult,
  IListHypermediaPagesResult,
  Queries,
} from '#queries.gen.ts';
import { entityFrom } from '#views/entities/entity-view.ts';

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

function entityCursorParameters(cursor?: HypermediaEntityContinuation) {
  return {
    cursorSharedPageCount: cursor?.sharedPageCount ?? null,
    cursorReadableId: cursor?.readableId ?? null,
  };
}

export interface HypermediaRepositoryContract {
  entityNeighborhood(input: {
    ownerId: string;
    anchor: HypermediaEntityReference;
    limit: number;
    cursor?: HypermediaEntityContinuation;
  }): Promise<HypermediaEntityNeighborhood | null>;
  pages(input: {
    ownerId: string;
    entities: HypermediaEntityReference[];
    visibleEntities: HypermediaEntityReference[];
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

  async entityNeighborhood({
    ownerId,
    anchor,
    limit,
    cursor,
  }: {
    ownerId: string;
    anchor: HypermediaEntityReference;
    limit: number;
    cursor?: HypermediaEntityContinuation;
  }): Promise<HypermediaEntityNeighborhood | null> {
    const { cursorSharedPageCount, cursorReadableId } = entityCursorParameters(cursor);
    const rowLimit = limit + 1;
    const [anchorRows, neighborRows] = await Promise.all([
      this.sql.FindHypermediaEntity`
        /* @notNull id readableId name description isSelf createdAt updatedAt */
        /* @type isSelf number */
        select entity."id", entity."readable_id" as "readableId", entity."name",
          entity."description", entity."entity_type" as "entityType", coalesce(profile."self_entity_id" is not null, 0) as "isSelf",
          image."id" as "imageId", image."readable_id" as "imageReadableId",
          image."name" as "imageName", image."media_type" as "imageMediaType",
          image."extension" as "imageExtension", image."size_bytes" as "imageSizeBytes",
          image."created_at" as "imageCreatedAt", image."updated_at" as "imageUpdatedAt",
          entity."created_at" as "createdAt", entity."updated_at" as "updatedAt"
        from "entity" entity
        left join "knowledge_profile" profile
          on profile."owner_id" = entity."owner_id" and profile."self_entity_id" = entity."id"
        left join "asset" image
          on image."owner_id" = entity."owner_id" and image."id" = entity."image_asset_id"
         and image."archived_at" is null
        where entity."owner_id" = ${ownerId} and entity."readable_id" = ${anchor.readableId}
          and entity."archived_at" is null
      `,
      this.sql.ListHypermediaEntityNeighbors`
        /* @notNull id readableId name description isSelf createdAt updatedAt sharedPageCount */
        /* @type isSelf number */
        /* @type sharedPageCount number */
        with anchor_revision as (
          select mention."source_revision_id" as "revisionId"
          from "entity" anchor_entity
          join "knowledge_page_entity_mention" mention
            on mention."owner_id" = anchor_entity."owner_id"
           and mention."target_entity_id" = anchor_entity."id"
          join "knowledge_page" page
            on page."owner_id" = mention."owner_id"
           and page."current_revision_id" = mention."source_revision_id"
           and page."archived_at" is null
          where anchor_entity."owner_id" = ${ownerId}
            and anchor_entity."readable_id" = ${anchor.readableId}
            and anchor_entity."archived_at" is null
        ), candidate as (
          select entity."id" as "entityId", entity."readable_id" as "readableId",
            count(distinct anchor_revision."revisionId") as "sharedPageCount"
          from anchor_revision
          join "knowledge_page_entity_mention" mention
            on mention."owner_id" = ${ownerId}
           and mention."source_revision_id" = anchor_revision."revisionId"
          join "entity" entity
            on entity."owner_id" = mention."owner_id" and entity."id" = mention."target_entity_id"
          where entity."archived_at" is null and entity."readable_id" != ${anchor.readableId}
          group by entity."id", entity."readable_id"
        )
        select entity."id", candidate."readableId", entity."name",
          entity."description", entity."entity_type" as "entityType", coalesce(profile."self_entity_id" is not null, 0) as "isSelf",
          image."id" as "imageId", image."readable_id" as "imageReadableId",
          image."name" as "imageName", image."media_type" as "imageMediaType",
          image."extension" as "imageExtension", image."size_bytes" as "imageSizeBytes",
          image."created_at" as "imageCreatedAt", image."updated_at" as "imageUpdatedAt",
          entity."created_at" as "createdAt", entity."updated_at" as "updatedAt",
          candidate."sharedPageCount"
        from candidate
        join "entity" entity on entity."id" = candidate."entityId" and entity."owner_id" = ${ownerId}
        left join "knowledge_profile" profile
          on profile."owner_id" = entity."owner_id" and profile."self_entity_id" = entity."id"
        left join "asset" image
          on image."owner_id" = entity."owner_id" and image."id" = entity."image_asset_id"
         and image."archived_at" is null
        where ${cursorSharedPageCount} is null
          or candidate."sharedPageCount" < ${cursorSharedPageCount}
          or (candidate."sharedPageCount" = ${cursorSharedPageCount}
            and candidate."readableId" > ${cursorReadableId})
        order by candidate."sharedPageCount" desc, candidate."readableId"
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
      anchor: entityFrom(anchorRow),
      neighbors: selectedRows.map(({ sharedPageCount, ...row }) => ({
        entity: entityFrom(row),
        sharedPageCount: Number(sharedPageCount),
      })),
      nextPage:
        neighborRows.length > limit && lastRow
          ? {
              sharedPageCount: Number(lastRow.sharedPageCount),
              readableId: lastRow.readableId,
            }
          : null,
    };
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
