import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type {
  FocusedHypermediaPages,
  HypermediaPage,
  HypermediaPageContinuation,
  HypermediaResource,
  HypermediaResourceContinuation,
  HypermediaResourceKind,
  HypermediaResourceNeighborhood,
  HypermediaResourceReference,
} from '#models/hypermedia/model.ts';
import type { KnowledgePageSummary } from '#models/knowledge-pages/model.ts';
import type { TemporalBounds } from '#models/knowledge-pages/temporal-coverage.ts';
import type { Queries } from '#queries.gen.ts';

const MAX_FOCUSED_PAGE_RESOURCE_REFERENCES = 120;

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

function pageCursorParameters(cursor?: HypermediaPageContinuation) {
  return {
    cursorRetained: cursor ? Number(cursor.retained) : null,
    cursorTemporal: cursor ? Number(cursor.temporal) : null,
    cursorOngoing: cursor ? Number(cursor.ongoing) : null,
    cursorLatest: cursor?.latest ?? null,
    cursorStart: cursor?.start ?? null,
    cursorUpdatedAt: cursor?.updatedAt ?? null,
    cursorReadableId: cursor?.readableId ?? null,
  };
}

export interface HypermediaRepositoryContract {
  resourceNeighborhood(input: {
    ownerId: string;
    anchor: HypermediaResourceReference;
    limit: number;
    cursor?: HypermediaResourceContinuation;
  }): Promise<HypermediaResourceNeighborhood | null>;
  focusedPages(input: {
    ownerId: string;
    resources: HypermediaResourceReference[];
    limit: number;
    cursor?: HypermediaPageContinuation;
    query?: string;
    temporalBounds?: TemporalBounds;
    retainPageReadableId?: string;
  }): Promise<FocusedHypermediaPages>;
}

export class HypermediaRepository implements HypermediaRepositoryContract {
  private readonly sql: TypedSQL<Queries>;

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  async resourceNeighborhood({
    ownerId,
    anchor,
    limit,
    cursor,
  }: {
    ownerId: string;
    anchor: HypermediaResourceReference;
    limit: number;
    cursor?: HypermediaResourceContinuation;
  }): Promise<HypermediaResourceNeighborhood | null> {
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

  async focusedPages({
    ownerId,
    resources,
    limit,
    cursor,
    query,
    temporalBounds,
    retainPageReadableId,
  }: {
    ownerId: string;
    resources: HypermediaResourceReference[];
    limit: number;
    cursor?: HypermediaPageContinuation;
    query?: string;
    temporalBounds?: TemporalBounds;
    retainPageReadableId?: string;
  }): Promise<FocusedHypermediaPages> {
    const resourceKeys = JSON.stringify(
      resources.map(({ kind, readableId }) => `${kind}:${readableId}`),
    );
    const normalizedQuery = query?.trim().toLocaleLowerCase() || null;
    const filterStart = temporalBounds?.start ?? null;
    const filterEnd = temporalBounds?.end ?? null;
    const retainedReadableId = retainPageReadableId ?? null;
    const rowLimit = limit + 1;
    const {
      cursorRetained,
      cursorTemporal,
      cursorOngoing,
      cursorLatest,
      cursorStart,
      cursorUpdatedAt,
      cursorReadableId,
    } = pageCursorParameters(cursor);
    const pageRows = await this.sql.ListFocusedHypermediaPages`
      /* @notNull id readableId revisionNumber title excerpt retainedSort temporalSort ongoingSort createdAt updatedAt */
      /* @type retainedSort number */
      /* @type temporalSort number */
      /* @type ongoingSort number */
      with focus_key as (
        select value as "key" from json_each(${resourceKeys})
      ), focused_revision as (
        select mention."source_revision_id" as "revisionId"
        from "knowledge_page_entity_mention" mention
        join "entity" entity
          on entity."owner_id" = mention."owner_id" and entity."id" = mention."target_entity_id"
        join focus_key on focus_key."key" = 'entity:' || entity."readable_id"
        where mention."owner_id" = ${ownerId} and entity."archived_at" is null
        union
        select usage."source_revision_id" as "revisionId"
        from "knowledge_page_asset_usage" usage
        join "asset" asset
          on asset."owner_id" = usage."owner_id" and asset."id" = usage."target_asset_id"
        join focus_key on focus_key."key" = 'asset:' || asset."readable_id"
        where usage."owner_id" = ${ownerId} and asset."archived_at" is null
      ), focused_page as (
        select page."id", page."readable_id" as "readableId",
          revision."revision_number" as "revisionNumber", revision."title", revision."excerpt",
          revision."temporal_coverage" as "temporalCoverage",
          page."readable_id" = ${retainedReadableId} as "retainedSort",
          revision."temporal_coverage" is not null as "temporalSort",
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
          and (
            page."readable_id" = ${retainedReadableId}
            or (
              page."current_revision_id" in (select "revisionId" from focused_revision)
              and (
                ${normalizedQuery} is null
                or instr(lower(revision."title"), ${normalizedQuery}) > 0
                or instr(lower(revision."excerpt"), ${normalizedQuery}) > 0
                or instr(page."readable_id", ${normalizedQuery}) > 0
                or exists (
                  select 1 from "knowledge_page_entity_mention" mention
                  join "entity" entity
                    on entity."id" = mention."target_entity_id"
                   and entity."owner_id" = mention."owner_id"
                  where mention."source_revision_id" = page."current_revision_id"
                    and mention."owner_id" = page."owner_id" and entity."archived_at" is null
                    and (
                      instr(lower(entity."name"), ${normalizedQuery}) > 0
                      or instr(lower(entity."description"), ${normalizedQuery}) > 0
                      or instr(entity."readable_id", ${normalizedQuery}) > 0
                    )
                )
                or exists (
                  select 1 from "knowledge_page_asset_usage" usage
                  join "asset" asset
                    on asset."id" = usage."target_asset_id" and asset."owner_id" = usage."owner_id"
                  where usage."source_revision_id" = page."current_revision_id"
                    and usage."owner_id" = page."owner_id" and asset."archived_at" is null
                    and (
                      instr(lower(asset."name"), ${normalizedQuery}) > 0
                      or instr(asset."readable_id", ${normalizedQuery}) > 0
                    )
                )
              )
              and (
                ${filterStart} is null
                or revision."temporal_coverage" is null
                or (
                  (${filterEnd} is null or revision."temporal_start_ms" < ${filterEnd})
                  and (revision."temporal_end_exclusive_ms" is null
                    or revision."temporal_end_exclusive_ms" > ${filterStart})
                )
              )
            )
          )
      )
      select * from focused_page
      where ${cursorUpdatedAt} is null
        or "retainedSort" < ${cursorRetained}
        or ("retainedSort" = ${cursorRetained} and "temporalSort" > ${cursorTemporal})
        or ("retainedSort" = ${cursorRetained} and "temporalSort" = ${cursorTemporal}
          and "ongoingSort" < ${cursorOngoing})
        or ("retainedSort" = ${cursorRetained} and "temporalSort" = ${cursorTemporal}
          and "ongoingSort" = ${cursorOngoing} and "latestSort" < ${cursorLatest})
        or ("retainedSort" = ${cursorRetained} and "temporalSort" = ${cursorTemporal}
          and "ongoingSort" = ${cursorOngoing} and "latestSort" is ${cursorLatest}
          and "startSort" < ${cursorStart})
        or ("retainedSort" = ${cursorRetained} and "temporalSort" = ${cursorTemporal}
          and "ongoingSort" = ${cursorOngoing} and "latestSort" is ${cursorLatest}
          and "startSort" is ${cursorStart} and "updatedAt" < ${cursorUpdatedAt})
        or ("retainedSort" = ${cursorRetained} and "temporalSort" = ${cursorTemporal}
          and "ongoingSort" = ${cursorOngoing} and "latestSort" is ${cursorLatest}
          and "startSort" is ${cursorStart} and "updatedAt" = ${cursorUpdatedAt}
          and "readableId" > ${cursorReadableId})
      order by "retainedSort" desc, "temporalSort", "ongoingSort" desc,
        "latestSort" desc, "startSort" desc, "updatedAt" desc, "readableId"
      limit ${rowLimit}
    `;
    const selectedPageRows = pageRows.slice(0, limit);
    const pages = selectedPageRows.map(
      (row): HypermediaPage => ({ ...pageSummaryFrom(row), resources: [] }),
    );
    if (pages.length === 0) {
      return { pages, nextPage: null, truncated: false };
    }
    const selectedPageIds = JSON.stringify(selectedPageRows.map(({ id }) => id));
    const referenceLimit = MAX_FOCUSED_PAGE_RESOURCE_REFERENCES + 1;
    const referenceRows = await this.sql.ListFocusedHypermediaPageResources`
      /* @notNull sourcePageReadableId kind readableId */
      /* @type kind 'entity' | 'asset' */
      with selected_page as (
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
      )
      select "sourcePageReadableId", "kind", "readableId" from page_resource
      order by row_number() over (
        partition by "sourcePageReadableId" order by "kind", "readableId"
      ), "sourcePageReadableId"
      limit ${referenceLimit}
    `;
    const pagesById = new Map(pages.map((page) => [page.readableId, page]));
    for (const row of referenceRows.slice(0, MAX_FOCUSED_PAGE_RESOURCE_REFERENCES)) {
      pagesById.get(row.sourcePageReadableId)?.resources.push({
        kind: row.kind,
        readableId: row.readableId,
      });
    }
    const lastPage = selectedPageRows.at(-1);
    return {
      pages,
      nextPage:
        pageRows.length > limit && lastPage
          ? {
              retained: Boolean(lastPage.retainedSort),
              temporal: Boolean(lastPage.temporalSort),
              ongoing: Boolean(lastPage.ongoingSort),
              latest: lastPage.latestSort === null ? null : Number(lastPage.latestSort),
              start: lastPage.startSort === null ? null : Number(lastPage.startSort),
              updatedAt: lastPage.updatedAt,
              readableId: lastPage.readableId,
            }
          : null,
      truncated: referenceRows.length > MAX_FOCUSED_PAGE_RESOURCE_REFERENCES,
    };
  }
}
