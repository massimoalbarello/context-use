import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import { type Page, pageFrom } from '#lib/pagination.ts';
import type { Entity } from '#models/entities/model.ts';
import type {
  KnowledgePageAssetUsage,
  KnowledgePageLinkSet,
  KnowledgePageReference,
  KnowledgePageRevisionActor,
  KnowledgePageRevisionSummary,
  KnowledgePageSummary,
  StoredKnowledgePage,
} from '#models/knowledge-pages/model.ts';
import type { TemporalBounds } from '#models/knowledge-pages/temporal-coverage.ts';
import type { ArchiveResult } from '#models/resource-archiving/model.ts';
import type { Queries } from '#queries.gen.ts';
import { entityFrom } from '#views/entities/entity-view.ts';

export interface KnowledgePagesRepositoryContract {
  create(input: {
    pageId: string;
    revisionId: string;
    ownerId: string;
    readableId: string;
    title: string;
    excerpt: string;
    temporalCoverage: string | null;
    temporalStart: number | null;
    temporalEnd: number | null;
    storageKey: string;
    contentHash: string;
    sizeBytes: number;
    links: KnowledgePageLinkSet;
    actor: KnowledgePageRevisionActor;
    createdAt: string;
  }): Promise<
    | { state: 'created'; page: StoredKnowledgePage }
    | { state: 'readable_id_conflict' }
    | { state: 'link_target_not_found'; target: string }
  >;
  update(input: {
    revisionId: string;
    ownerId: string;
    readableId: string;
    expectedRevisionNumber: number;
    title: string;
    excerpt: string;
    temporalCoverage: string | null;
    temporalStart: number | null;
    temporalEnd: number | null;
    storageKey: string;
    contentHash: string;
    sizeBytes: number;
    links: KnowledgePageLinkSet;
    actor: KnowledgePageRevisionActor;
    updatedAt: string;
  }): Promise<
    | { state: 'updated'; page: StoredKnowledgePage }
    | { state: 'not_found' }
    | { state: 'revision_conflict'; currentRevisionNumber: number }
    | { state: 'link_target_not_found'; target: string }
  >;
  list(input: {
    ownerId: string;
    limit: number;
    offset: number;
    query?: string;
    temporalBounds?: TemporalBounds;
  }): Promise<Page<KnowledgePageSummary>>;
  listByEntity(input: {
    ownerId: string;
    entityReadableId: string;
  }): Promise<KnowledgePageSummary[]>;
  find(input: { ownerId: string; readableId: string }): Promise<StoredKnowledgePage | null>;
  archive(input: {
    ownerId: string;
    readableId: string;
    archivedAt: string;
  }): Promise<ArchiveResult<KnowledgePageReference>>;
  detail(input: { ownerId: string; readableId: string }): Promise<{
    page: StoredKnowledgePage;
    mentions: Entity[];
    references: KnowledgePageReference[];
    backlinks: KnowledgePageReference[];
    assetUsages: KnowledgePageAssetUsage[];
    revisions: KnowledgePageRevisionSummary[];
  } | null>;
  listCurrent(input: { ownerId: string }): Promise<StoredKnowledgePage[]>;
  replaceCurrentIndex(input: {
    ownerId: string;
    readableId: string;
    title: string;
    excerpt: string;
    links: KnowledgePageLinkSet;
  }): Promise<{ state: 'replaced' } | { state: 'link_target_not_found'; target: string }>;
}

type StoredPageRow = Queries['FindKnowledgePage'];

type SummaryRow = Queries['SearchKnowledgePages'];

type RevisionSummaryRow = Queries['ListKnowledgePageRevisions'];

async function revisionAuthorColumns({
  db,
  ownerId,
  actor,
}: {
  db: TypedSQL<Queries>;
  ownerId: string;
  actor: KnowledgePageRevisionActor;
}): Promise<{
  kind: KnowledgePageRevisionActor['kind'];
  clientAuthorizationId: string | null;
  name: string;
}> {
  if (actor.kind === 'mcp_client') {
    return {
      kind: actor.kind,
      clientAuthorizationId: actor.clientAuthorizationId,
      name: actor.name,
    };
  }

  const authors = await db.FindKnowledgePageOwnerRevisionAuthor`
    /* @notNull name */
    /* @type name string */
    select coalesce(entity."name", auth_user."name") as "name"
    from "auth_user" auth_user
    left join "knowledge_profile" profile on profile."owner_id" = auth_user."id"
    left join "entity" entity
      on entity."id" = profile."self_entity_id" and entity."owner_id" = profile."owner_id"
    where auth_user."id" = ${ownerId}
  `;
  const author = authors[0];
  if (!author) {
    throw new Error('Knowledge page revision owner attribution could not be resolved');
  }
  return { kind: actor.kind, clientAuthorizationId: null, name: author.name };
}

function storedPageFrom(row: StoredPageRow): StoredKnowledgePage {
  return { ...row, revisionNumber: Number(row.revisionNumber), sizeBytes: Number(row.sizeBytes) };
}

function summaryFrom(row: SummaryRow): KnowledgePageSummary {
  return { ...row, revisionNumber: Number(row.revisionNumber) };
}

function revisionSummaryFrom(row: RevisionSummaryRow): KnowledgePageRevisionSummary {
  if (row.authorKind === 'owner' && row.authorName) {
    return {
      revisionNumber: Number(row.revisionNumber),
      title: row.title,
      temporalCoverage: row.temporalCoverage,
      author: { kind: 'owner', name: row.authorName },
      createdAt: row.createdAt,
    };
  }
  if (row.authorKind === 'mcp_client' && row.authorName) {
    return {
      revisionNumber: Number(row.revisionNumber),
      title: row.title,
      temporalCoverage: row.temporalCoverage,
      author: { kind: 'mcp_client', name: row.authorName },
      createdAt: row.createdAt,
    };
  }
  throw new Error('Knowledge page revision has invalid author attribution');
}

async function findCurrentKnowledgePage({
  db,
  ownerId,
  readableId,
}: {
  db: TypedSQL<Queries>;
  ownerId: string;
  readableId: string;
}): Promise<StoredKnowledgePage | null> {
  const rows = await db.FindCurrentKnowledgePage`
    /* @notNull id ownerId readableId currentRevisionId revisionNumber title excerpt storageKey contentHash sizeBytes createdAt updatedAt */
    select page."id", page."owner_id" as "ownerId", page."readable_id" as "readableId",
      page."current_revision_id" as "currentRevisionId",
      revision."revision_number" as "revisionNumber", revision."title", revision."excerpt",
      revision."temporal_coverage" as "temporalCoverage",
      revision."storage_key" as "storageKey", revision."content_hash" as "contentHash",
      revision."size_bytes" as "sizeBytes", page."created_at" as "createdAt",
      page."updated_at" as "updatedAt"
    from "knowledge_page" page
    join "knowledge_page_revision" revision
      on revision."id" = page."current_revision_id"
     and revision."page_id" = page."id"
     and revision."owner_id" = page."owner_id"
    where page."owner_id" = ${ownerId} and page."readable_id" = ${readableId}
      and page."archived_at" is null
  `;
  return rows[0] ? storedPageFrom(rows[0]) : null;
}

async function resolveLinks({
  db,
  ownerId,
  links,
  self,
}: {
  db: TypedSQL<Queries>;
  ownerId: string;
  links: KnowledgePageLinkSet;
  self?: { id: string; readableId: string };
}): Promise<
  | {
      state: 'resolved';
      entityIds: string[];
      pageReferences: Array<{ pageId: string; fragment: string | null }>;
      assetUsages: Array<{ assetId: string; presentation: 'embed' | 'attachment' }>;
    }
  | { state: 'link_target_not_found'; target: string }
> {
  const entityIds: string[] = [];
  for (const readableId of links.entityReadableIds) {
    const rows = await db.ResolveEntityLink`
      select "id" from "entity"
      where "owner_id" = ${ownerId} and "readable_id" = ${readableId}
        and "archived_at" is null
    `;
    if (!rows[0]) {
      return { state: 'link_target_not_found', target: `entity/${readableId}` };
    }
    entityIds.push(rows[0].id);
  }

  const pageReferences: Array<{ pageId: string; fragment: string | null }> = [];
  for (const reference of links.pageReferences) {
    if (self?.readableId === reference.readableId) {
      pageReferences.push({ pageId: self.id, fragment: reference.fragment });
      continue;
    }
    const rows = await db.ResolvePageLink`
      select "id" from "knowledge_page"
      where "owner_id" = ${ownerId} and "readable_id" = ${reference.readableId}
        and "archived_at" is null
    `;
    if (!rows[0]) {
      return { state: 'link_target_not_found', target: `page/${reference.readableId}` };
    }
    pageReferences.push({ pageId: rows[0].id, fragment: reference.fragment });
  }

  const assetUsages: Array<{ assetId: string; presentation: 'embed' | 'attachment' }> = [];
  for (const usage of links.assetUsages) {
    const rows = await db.ResolveAssetLink`
      select "id" from "asset"
      where "owner_id" = ${ownerId} and "readable_id" = ${usage.readableId}
        and "archived_at" is null
    `;
    if (!rows[0]) {
      return { state: 'link_target_not_found', target: `asset/${usage.readableId}` };
    }
    assetUsages.push({ assetId: rows[0].id, presentation: usage.presentation });
  }

  return { state: 'resolved', entityIds, pageReferences, assetUsages };
}

async function insertLinks({
  db,
  ownerId,
  revisionId,
  entityIds,
  pageReferences,
  assetUsages,
}: {
  db: TypedSQL<Queries>;
  ownerId: string;
  revisionId: string;
  entityIds: string[];
  pageReferences: Array<{ pageId: string; fragment: string | null }>;
  assetUsages: Array<{ assetId: string; presentation: 'embed' | 'attachment' }>;
}): Promise<void> {
  for (const entityId of entityIds) {
    await db`
      insert into "knowledge_page_entity_mention"
        ("owner_id", "source_revision_id", "target_entity_id")
      values (${ownerId}, ${revisionId}, ${entityId})
    `;
  }
  for (const reference of pageReferences) {
    await db`
      insert into "knowledge_page_reference"
        ("owner_id", "source_revision_id", "target_page_id", "target_fragment")
      values (${ownerId}, ${revisionId}, ${reference.pageId}, ${reference.fragment ?? ''})
    `;
  }
  for (const usage of assetUsages) {
    await db`
      insert into "knowledge_page_asset_usage"
        ("owner_id", "source_revision_id", "target_asset_id", "presentation")
      values (${ownerId}, ${revisionId}, ${usage.assetId}, ${usage.presentation})
    `;
  }
}

export class KnowledgePagesRepository implements KnowledgePagesRepositoryContract {
  private readonly sql: TypedSQL<Queries>;

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  create(input: {
    pageId: string;
    revisionId: string;
    ownerId: string;
    readableId: string;
    title: string;
    excerpt: string;
    temporalCoverage: string | null;
    temporalStart: number | null;
    temporalEnd: number | null;
    storageKey: string;
    contentHash: string;
    sizeBytes: number;
    links: KnowledgePageLinkSet;
    actor: KnowledgePageRevisionActor;
    createdAt: string;
  }): Promise<
    | { state: 'created'; page: StoredKnowledgePage }
    | { state: 'readable_id_conflict' }
    | { state: 'link_target_not_found'; target: string }
  > {
    return this.sql.begin(async (db) => {
      const resolved = await resolveLinks({
        db,
        ownerId: input.ownerId,
        links: input.links,
        self: { id: input.pageId, readableId: input.readableId },
      });
      if (resolved.state !== 'resolved') {
        return resolved;
      }

      const createdPages = await db.CreateKnowledgePage`
        /* @notNull id */
        insert into "knowledge_page"
          ("id", "owner_id", "readable_id", "current_revision_id", "created_at", "updated_at")
        values
          (${input.pageId}, ${input.ownerId}, ${input.readableId}, ${input.revisionId},
           ${input.createdAt}, ${input.createdAt})
        on conflict ("owner_id", "readable_id") do nothing
        returning "id"
      `;
      if (!createdPages[0]) {
        return { state: 'readable_id_conflict' } as const;
      }
      const author = await revisionAuthorColumns({
        db,
        ownerId: input.ownerId,
        actor: input.actor,
      });
      await db`
        insert into "knowledge_page_revision"
          ("id", "page_id", "owner_id", "revision_number", "title", "excerpt",
           "temporal_coverage", "temporal_start", "temporal_end", "storage_key", "size_bytes",
           "content_hash", "author_kind",
           "author_mcp_client_authorization_id", "author_name", "created_at")
        values
          (${input.revisionId}, ${input.pageId}, ${input.ownerId}, 1, ${input.title},
           ${input.excerpt}, ${input.temporalCoverage}, ${input.temporalStart}, ${input.temporalEnd},
           ${input.storageKey}, ${input.sizeBytes}, ${input.contentHash},
           ${author.kind}, ${author.clientAuthorizationId}, ${author.name}, ${input.createdAt})
      `;
      await insertLinks({
        db,
        ownerId: input.ownerId,
        revisionId: input.revisionId,
        entityIds: resolved.entityIds,
        pageReferences: resolved.pageReferences,
        assetUsages: resolved.assetUsages,
      });

      return {
        state: 'created' as const,
        page: {
          id: input.pageId,
          ownerId: input.ownerId,
          readableId: input.readableId,
          currentRevisionId: input.revisionId,
          revisionNumber: 1,
          title: input.title,
          excerpt: input.excerpt,
          temporalCoverage: input.temporalCoverage,
          storageKey: input.storageKey,
          contentHash: input.contentHash,
          sizeBytes: input.sizeBytes,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        },
      };
    });
  }

  update(input: {
    revisionId: string;
    ownerId: string;
    readableId: string;
    expectedRevisionNumber: number;
    title: string;
    excerpt: string;
    temporalCoverage: string | null;
    temporalStart: number | null;
    temporalEnd: number | null;
    storageKey: string;
    contentHash: string;
    sizeBytes: number;
    links: KnowledgePageLinkSet;
    actor: KnowledgePageRevisionActor;
    updatedAt: string;
  }): Promise<
    | { state: 'updated'; page: StoredKnowledgePage }
    | { state: 'not_found' }
    | { state: 'revision_conflict'; currentRevisionNumber: number }
    | { state: 'link_target_not_found'; target: string }
  > {
    return this.sql.begin(async (db) => {
      const current = await findCurrentKnowledgePage({
        db,
        ownerId: input.ownerId,
        readableId: input.readableId,
      });
      if (!current) {
        return { state: 'not_found' } as const;
      }
      if (current.revisionNumber !== input.expectedRevisionNumber) {
        return {
          state: 'revision_conflict' as const,
          currentRevisionNumber: current.revisionNumber,
        };
      }
      const resolved = await resolveLinks({
        db,
        ownerId: input.ownerId,
        links: input.links,
        self: { id: current.id, readableId: current.readableId },
      });
      if (resolved.state !== 'resolved') {
        return resolved;
      }
      const revisionNumber = current.revisionNumber + 1;
      await db`
        delete from "knowledge_page_entity_mention"
        where "owner_id" = ${input.ownerId}
          and "source_revision_id" = ${current.currentRevisionId}
      `;
      await db`
        delete from "knowledge_page_reference"
        where "owner_id" = ${input.ownerId}
          and "source_revision_id" = ${current.currentRevisionId}
      `;
      await db`
        delete from "knowledge_page_asset_usage"
        where "owner_id" = ${input.ownerId}
          and "source_revision_id" = ${current.currentRevisionId}
      `;
      const author = await revisionAuthorColumns({
        db,
        ownerId: input.ownerId,
        actor: input.actor,
      });
      await db`
        insert into "knowledge_page_revision"
          ("id", "page_id", "owner_id", "revision_number", "title", "excerpt",
           "temporal_coverage", "temporal_start", "temporal_end", "storage_key", "size_bytes",
           "content_hash", "author_kind",
           "author_mcp_client_authorization_id", "author_name", "created_at")
        values
          (${input.revisionId}, ${current.id}, ${input.ownerId}, ${revisionNumber}, ${input.title},
           ${input.excerpt}, ${input.temporalCoverage}, ${input.temporalStart}, ${input.temporalEnd},
           ${input.storageKey}, ${input.sizeBytes}, ${input.contentHash},
           ${author.kind}, ${author.clientAuthorizationId}, ${author.name}, ${input.updatedAt})
      `;
      await insertLinks({
        db,
        ownerId: input.ownerId,
        revisionId: input.revisionId,
        entityIds: resolved.entityIds,
        pageReferences: resolved.pageReferences,
        assetUsages: resolved.assetUsages,
      });
      await db`
        update "knowledge_page"
        set "current_revision_id" = ${input.revisionId}, "updated_at" = ${input.updatedAt}
        where "id" = ${current.id} and "owner_id" = ${input.ownerId}
      `;
      return {
        state: 'updated' as const,
        page: {
          ...current,
          currentRevisionId: input.revisionId,
          revisionNumber,
          title: input.title,
          excerpt: input.excerpt,
          temporalCoverage: input.temporalCoverage,
          storageKey: input.storageKey,
          contentHash: input.contentHash,
          sizeBytes: input.sizeBytes,
          updatedAt: input.updatedAt,
        },
      };
    });
  }

  async list({
    ownerId,
    limit,
    offset,
    query,
    temporalBounds,
  }: {
    ownerId: string;
    limit: number;
    offset: number;
    query?: string;
    temporalBounds?: TemporalBounds;
  }) {
    const normalizedQuery = query?.trim() || null;
    const filterStart = temporalBounds?.start ?? null;
    const filterEnd = temporalBounds?.end ?? null;
    const rowsPromise = this.sql.SearchKnowledgePages`
      /* @notNull id readableId revisionNumber title excerpt createdAt updatedAt */
      select page."id", page."readable_id" as "readableId",
        revision."revision_number" as "revisionNumber", revision."title", revision."excerpt",
        revision."temporal_coverage" as "temporalCoverage",
        page."created_at" as "createdAt", page."updated_at" as "updatedAt"
      from "knowledge_page" page
      join "knowledge_page_revision" revision on revision."id" = page."current_revision_id"
      where page."owner_id" = ${ownerId}
        and page."archived_at" is null
        and (
          ${normalizedQuery} is null
          or instr(lower(revision."title"), lower(${normalizedQuery})) > 0
          or instr(page."readable_id", lower(${normalizedQuery})) > 0
        )
        and (
          ${filterStart} is null
          or (
            revision."temporal_coverage" is not null
            and (${filterEnd} is null or revision."temporal_start" < ${filterEnd})
            and (revision."temporal_end" is null or revision."temporal_end" > ${filterStart})
          )
        )
      order by
        case
          when ${normalizedQuery} is not null and ${filterStart} is null then 0
          when revision."temporal_coverage" is not null and revision."temporal_end" is null then 0
          when revision."temporal_coverage" is not null then 1
          else 2
        end,
        case when ${normalizedQuery} is not null and ${filterStart} is null
          then revision."title" end collate nocase,
        case when revision."temporal_coverage" is not null and revision."temporal_end" is null
          then revision."temporal_start" end desc,
        case when revision."temporal_coverage" is not null and revision."temporal_end" is not null
          then revision."temporal_end" end desc,
        case when revision."temporal_coverage" is not null
          then revision."temporal_start" end desc,
        revision."title" collate nocase,
        page."readable_id"
      limit ${limit} offset ${offset}
    `;
    const countsPromise = this.sql.CountSearchedKnowledgePages`
      /* @notNull total */
      select count(*) as "total"
      from "knowledge_page" page
      join "knowledge_page_revision" revision on revision."id" = page."current_revision_id"
      where page."owner_id" = ${ownerId}
        and page."archived_at" is null
        and (
          ${normalizedQuery} is null
          or instr(lower(revision."title"), lower(${normalizedQuery})) > 0
          or instr(page."readable_id", lower(${normalizedQuery})) > 0
        )
        and (
          ${filterStart} is null
          or (
            revision."temporal_coverage" is not null
            and (${filterEnd} is null or revision."temporal_start" < ${filterEnd})
            and (revision."temporal_end" is null or revision."temporal_end" > ${filterStart})
          )
        )
    `;
    const [rows, counts] = await Promise.all([rowsPromise, countsPromise]);
    return pageFrom({
      items: rows.map(summaryFrom),
      total: Number(counts[0]?.total ?? 0),
      offset,
    });
  }

  async listByEntity({
    ownerId,
    entityReadableId,
  }: {
    ownerId: string;
    entityReadableId: string;
  }): Promise<KnowledgePageSummary[]> {
    const rows = await this.sql.ListKnowledgePagesByEntity`
      /* @notNull id readableId revisionNumber title excerpt createdAt updatedAt */
      select page."id", page."readable_id" as "readableId",
        revision."revision_number" as "revisionNumber", revision."title", revision."excerpt",
        revision."temporal_coverage" as "temporalCoverage",
        page."created_at" as "createdAt", page."updated_at" as "updatedAt"
      from "entity" entity
      join "knowledge_page_entity_mention" mention
        on mention."target_entity_id" = entity."id" and mention."owner_id" = entity."owner_id"
      join "knowledge_page" page
        on page."current_revision_id" = mention."source_revision_id"
       and page."owner_id" = mention."owner_id"
      join "knowledge_page_revision" revision on revision."id" = page."current_revision_id"
      where entity."owner_id" = ${ownerId} and entity."readable_id" = ${entityReadableId}
        and entity."archived_at" is null and page."archived_at" is null
      order by
        case
          when revision."temporal_coverage" is not null and revision."temporal_end" is null then 0
          when revision."temporal_coverage" is not null then 1
          else 2
        end,
        case when revision."temporal_coverage" is not null and revision."temporal_end" is null
          then revision."temporal_start" end desc,
        case when revision."temporal_coverage" is not null and revision."temporal_end" is not null
          then revision."temporal_end" end desc,
        case when revision."temporal_coverage" is not null
          then revision."temporal_start" end desc,
        revision."title" collate nocase,
        page."readable_id"
    `;
    return rows.map(summaryFrom);
  }

  async find({
    ownerId,
    readableId,
  }: {
    ownerId: string;
    readableId: string;
  }): Promise<StoredKnowledgePage | null> {
    const rows = await this.sql.FindKnowledgePage`
      /* @notNull id ownerId readableId currentRevisionId revisionNumber title excerpt storageKey contentHash sizeBytes createdAt updatedAt */
      select page."id", page."owner_id" as "ownerId", page."readable_id" as "readableId",
        page."current_revision_id" as "currentRevisionId",
        revision."revision_number" as "revisionNumber", revision."title", revision."excerpt",
        revision."temporal_coverage" as "temporalCoverage",
        revision."storage_key" as "storageKey", revision."content_hash" as "contentHash",
        revision."size_bytes" as "sizeBytes", page."created_at" as "createdAt",
        page."updated_at" as "updatedAt"
      from "knowledge_page" page
      join "knowledge_page_revision" revision
        on revision."id" = page."current_revision_id"
       and revision."page_id" = page."id"
       and revision."owner_id" = page."owner_id"
      where page."owner_id" = ${ownerId} and page."readable_id" = ${readableId}
        and page."archived_at" is null
    `;
    return rows[0] ? storedPageFrom(rows[0]) : null;
  }

  archive({
    ownerId,
    readableId,
    archivedAt,
  }: {
    ownerId: string;
    readableId: string;
    archivedAt: string;
  }): Promise<ArchiveResult<KnowledgePageReference>> {
    return this.sql.begin(async (db) => {
      const targets = await db.FindKnowledgePageArchiveTarget`
        /* @notNull id currentRevisionId */
        select "id", "current_revision_id" as "currentRevisionId",
          "archived_at" as "archivedAt"
        from "knowledge_page"
        where "owner_id" = ${ownerId} and "readable_id" = ${readableId}
      `;
      const target = targets[0];
      if (!target) {
        return { state: 'not_found' } as const;
      }
      if (target.archivedAt) {
        return { state: 'archived' } as const;
      }
      const blockers = await this.listActiveReferringPages({
        db,
        ownerId,
        pageId: target.id,
      });
      if (blockers.length > 0) {
        return { state: 'resource_in_use' as const, blockers };
      }
      await db`
        delete from "knowledge_page_entity_mention"
        where "owner_id" = ${ownerId}
          and "source_revision_id" = ${target.currentRevisionId}
      `;
      await db`
        delete from "knowledge_page_reference"
        where "owner_id" = ${ownerId}
          and "source_revision_id" = ${target.currentRevisionId}
      `;
      await db`
        delete from "knowledge_page_asset_usage"
        where "owner_id" = ${ownerId}
          and "source_revision_id" = ${target.currentRevisionId}
      `;
      await db`
        update "knowledge_page"
        set "archived_at" = ${archivedAt}
        where "owner_id" = ${ownerId} and "id" = ${target.id}
      `;
      return { state: 'archived' } as const;
    });
  }

  async detail({ ownerId, readableId }: { ownerId: string; readableId: string }): Promise<{
    page: StoredKnowledgePage;
    mentions: Entity[];
    references: KnowledgePageReference[];
    backlinks: KnowledgePageReference[];
    assetUsages: KnowledgePageAssetUsage[];
    revisions: KnowledgePageRevisionSummary[];
  } | null> {
    const page = await this.find({ ownerId, readableId });
    if (!page) {
      return null;
    }
    const [mentions, references, backlinks, assetUsages, revisions] = await Promise.all([
      this.sql.ListKnowledgePageMentions`
        /* @notNull id readableId name description createdAt updatedAt */
        /* @type isSelf number */
        select entity."id", entity."readable_id" as "readableId", entity."name",
          entity."description", profile."self_entity_id" is not null as "isSelf",
          entity."created_at" as "createdAt",
          entity."updated_at" as "updatedAt", image."id" as "imageId",
          image."readable_id" as "imageReadableId", image."name" as "imageName",
          image."media_type" as "imageMediaType", image."extension" as "imageExtension",
          image."size_bytes" as "imageSizeBytes", image."created_at" as "imageCreatedAt",
          image."updated_at" as "imageUpdatedAt"
        from "knowledge_page_entity_mention" mention
        join "entity" entity
          on entity."id" = mention."target_entity_id" and entity."owner_id" = mention."owner_id"
        left join "knowledge_profile" profile
          on profile."owner_id" = entity."owner_id" and profile."self_entity_id" = entity."id"
        left join "asset" image
          on image."owner_id" = entity."owner_id" and image."id" = entity."image_asset_id"
         and image."archived_at" is null
        where mention."owner_id" = ${ownerId}
          and mention."source_revision_id" = ${page.currentRevisionId}
          and entity."archived_at" is null
        order by entity."name" collate nocase, entity."readable_id"
      `,
      this.referenceRows({ ownerId, sourceRevisionId: page.currentRevisionId }),
      this.backlinkRows({ ownerId, targetPageId: page.id }),
      this.assetUsageRows({ ownerId, sourceRevisionId: page.currentRevisionId }),
      this.sql.ListKnowledgePageRevisions`
        /* @notNull revisionNumber title authorKind createdAt */
        select revision."revision_number" as "revisionNumber", revision."title",
          revision."temporal_coverage" as "temporalCoverage",
          revision."author_kind" as "authorKind", revision."author_name" as "authorName",
          revision."created_at" as "createdAt"
        from "knowledge_page_revision" revision
        where revision."owner_id" = ${ownerId} and revision."page_id" = ${page.id}
        order by revision."revision_number" desc
      `,
    ]);
    return {
      page,
      mentions: mentions.map(entityFrom),
      references,
      backlinks,
      assetUsages,
      revisions: revisions.map(revisionSummaryFrom),
    };
  }

  async listCurrent({ ownerId }: { ownerId: string }): Promise<StoredKnowledgePage[]> {
    const rows = await this.sql.ListCurrentKnowledgePages`
      /* @notNull id ownerId readableId currentRevisionId revisionNumber title excerpt storageKey contentHash sizeBytes createdAt updatedAt */
      select page."id", page."owner_id" as "ownerId", page."readable_id" as "readableId",
        page."current_revision_id" as "currentRevisionId",
        revision."revision_number" as "revisionNumber", revision."title", revision."excerpt",
        revision."temporal_coverage" as "temporalCoverage",
        revision."storage_key" as "storageKey", revision."content_hash" as "contentHash",
        revision."size_bytes" as "sizeBytes", page."created_at" as "createdAt",
        page."updated_at" as "updatedAt"
      from "knowledge_page" page
      join "knowledge_page_revision" revision
        on revision."id" = page."current_revision_id"
       and revision."page_id" = page."id"
       and revision."owner_id" = page."owner_id"
      where page."owner_id" = ${ownerId} and page."archived_at" is null
      order by page."id"
    `;
    return rows.map(storedPageFrom);
  }

  replaceCurrentIndex({
    ownerId,
    readableId,
    title,
    excerpt,
    links,
  }: {
    ownerId: string;
    readableId: string;
    title: string;
    excerpt: string;
    links: KnowledgePageLinkSet;
  }): Promise<{ state: 'replaced' } | { state: 'link_target_not_found'; target: string }> {
    return this.sql.begin(async (db) => {
      const pages = await db.FindKnowledgePageForIndexReplacement`
        /* @notNull id currentRevisionId */
        select "id", "current_revision_id" as "currentRevisionId"
        from "knowledge_page"
        where "owner_id" = ${ownerId} and "readable_id" = ${readableId}
          and "archived_at" is null
      `;
      const page = pages[0];
      if (!page) {
        return { state: 'link_target_not_found' as const, target: `page/${readableId}` };
      }
      const resolved = await resolveLinks({
        db,
        ownerId,
        links,
        self: { id: page.id, readableId },
      });
      if (resolved.state !== 'resolved') {
        return resolved;
      }
      await db`
        update "knowledge_page_revision"
        set "title" = ${title}, "excerpt" = ${excerpt}
        where "owner_id" = ${ownerId} and "id" = ${page.currentRevisionId}
      `;
      await db`
        delete from "knowledge_page_entity_mention"
        where "owner_id" = ${ownerId} and "source_revision_id" = ${page.currentRevisionId}
      `;
      await db`
        delete from "knowledge_page_reference"
        where "owner_id" = ${ownerId} and "source_revision_id" = ${page.currentRevisionId}
      `;
      await db`
        delete from "knowledge_page_asset_usage"
        where "owner_id" = ${ownerId} and "source_revision_id" = ${page.currentRevisionId}
      `;
      await insertLinks({
        db,
        ownerId,
        revisionId: page.currentRevisionId,
        entityIds: resolved.entityIds,
        pageReferences: resolved.pageReferences,
        assetUsages: resolved.assetUsages,
      });
      return { state: 'replaced' as const };
    });
  }

  private async listActiveReferringPages({
    db,
    ownerId,
    pageId,
  }: {
    db: TypedSQL<Queries>;
    ownerId: string;
    pageId: string;
  }): Promise<KnowledgePageReference[]> {
    const rows = await db.ListActiveKnowledgePageReferrers`
      /* @notNull id readableId revisionNumber title excerpt createdAt updatedAt fragment */
      select referring_page."id", referring_page."readable_id" as "readableId",
        current_referring_revision."revision_number" as "revisionNumber",
        current_referring_revision."title", current_referring_revision."excerpt",
        current_referring_revision."temporal_coverage" as "temporalCoverage",
        referring_page."created_at" as "createdAt", referring_page."updated_at" as "updatedAt",
        inbound_reference."target_fragment" as "fragment"
      from "knowledge_page_reference" inbound_reference
      join "knowledge_page_revision" current_referring_revision
        on current_referring_revision."id" = inbound_reference."source_revision_id"
       and current_referring_revision."owner_id" = inbound_reference."owner_id"
      join "knowledge_page" referring_page
        on referring_page."id" = current_referring_revision."page_id"
       and referring_page."owner_id" = inbound_reference."owner_id"
       and referring_page."current_revision_id" = current_referring_revision."id"
       and referring_page."archived_at" is null
      where inbound_reference."owner_id" = ${ownerId}
        and inbound_reference."target_page_id" = ${pageId}
      order by current_referring_revision."title", referring_page."readable_id",
        inbound_reference."target_fragment"
    `;
    return rows.map(({ fragment, ...page }) => ({
      page: summaryFrom(page),
      fragment: fragment || null,
    }));
  }

  private async referenceRows({
    ownerId,
    sourceRevisionId,
  }: {
    ownerId: string;
    sourceRevisionId: string;
  }): Promise<KnowledgePageReference[]> {
    const rows = await this.sql.ListKnowledgePageReferences`
      /* @notNull id readableId revisionNumber title excerpt createdAt updatedAt fragment */
      select page."id", page."readable_id" as "readableId",
        revision."revision_number" as "revisionNumber", revision."title", revision."excerpt",
        revision."temporal_coverage" as "temporalCoverage",
        page."created_at" as "createdAt", page."updated_at" as "updatedAt",
        reference."target_fragment" as "fragment"
      from "knowledge_page_reference" reference
      join "knowledge_page" page
        on page."id" = reference."target_page_id" and page."owner_id" = reference."owner_id"
      join "knowledge_page_revision" revision on revision."id" = page."current_revision_id"
      where reference."owner_id" = ${ownerId}
        and reference."source_revision_id" = ${sourceRevisionId}
        and page."archived_at" is null
      order by revision."title", page."readable_id", reference."target_fragment"
    `;
    return rows.map(({ fragment, ...row }) => ({
      page: summaryFrom(row),
      fragment: fragment || null,
    }));
  }

  private async backlinkRows({
    ownerId,
    targetPageId,
  }: {
    ownerId: string;
    targetPageId: string;
  }): Promise<KnowledgePageReference[]> {
    const rows = await this.sql.ListKnowledgePageBacklinks`
      /* @notNull id readableId revisionNumber title excerpt createdAt updatedAt fragment */
      select page."id", page."readable_id" as "readableId",
        revision."revision_number" as "revisionNumber", revision."title", revision."excerpt",
        revision."temporal_coverage" as "temporalCoverage",
        page."created_at" as "createdAt", page."updated_at" as "updatedAt",
        reference."target_fragment" as "fragment"
      from "knowledge_page_reference" reference
      join "knowledge_page_revision" source_revision
        on source_revision."id" = reference."source_revision_id"
      join "knowledge_page" page
        on page."id" = source_revision."page_id"
       and page."current_revision_id" = source_revision."id"
       and page."owner_id" = reference."owner_id"
      join "knowledge_page_revision" revision on revision."id" = page."current_revision_id"
      where reference."owner_id" = ${ownerId} and reference."target_page_id" = ${targetPageId}
        and page."archived_at" is null
      order by revision."title", page."readable_id", reference."target_fragment"
    `;
    return rows.map(({ fragment, ...row }) => ({
      page: summaryFrom(row),
      fragment: fragment || null,
    }));
  }

  private async assetUsageRows({
    ownerId,
    sourceRevisionId,
  }: {
    ownerId: string;
    sourceRevisionId: string;
  }): Promise<KnowledgePageAssetUsage[]> {
    const rows = await this.sql.ListKnowledgePageAssetUsages`
      /* @notNull id readableId name mediaType sizeBytes createdAt updatedAt */
      /* @type presentation 'embed' | 'attachment' */
      select asset."id", asset."readable_id" as "readableId", asset."name",
        asset."media_type" as "mediaType", asset."extension",
        asset."size_bytes" as "sizeBytes", asset."created_at" as "createdAt",
        asset."updated_at" as "updatedAt", usage."presentation"
      from "knowledge_page_asset_usage" usage
      join "asset" asset
        on asset."id" = usage."target_asset_id" and asset."owner_id" = usage."owner_id"
      where usage."owner_id" = ${ownerId}
        and usage."source_revision_id" = ${sourceRevisionId}
        and asset."archived_at" is null
      order by asset."name" collate nocase, asset."readable_id", usage."presentation"
    `;
    return rows.map(({ presentation, ...asset }) => ({
      asset: { ...asset, sizeBytes: Number(asset.sizeBytes) },
      presentation,
    }));
  }
}
