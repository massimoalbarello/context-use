import type { SQL } from 'bun';
import type { Entity } from '#entities/entity.ts';
import type {
  KnowledgePageLinkSet,
  KnowledgePageReference,
  KnowledgePageRevisionSummary,
  KnowledgePageSummary,
  KnowledgePagesRepositoryContract,
  StoredKnowledgePage,
} from '#pages/knowledge-page.ts';
import { pageFrom } from '#pagination/page.ts';
import { Repository } from '#repositories/repository.ts';

type StoredPageRow = {
  id: string;
  ownerId: string;
  readableId: string;
  currentRevisionId: string;
  revisionNumber: number;
  title: string;
  excerpt: string;
  storageKey: string;
  contentHash: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
};

type SummaryRow = Omit<
  StoredPageRow,
  'ownerId' | 'currentRevisionId' | 'storageKey' | 'contentHash' | 'sizeBytes'
>;

type RevisionSummaryRow = {
  revisionNumber: number;
  title: string;
  createdAt: string;
};

const CURRENT_PAGE_SELECT = `
  select page."id", page."owner_id" as "ownerId", page."readable_id" as "readableId",
    page."current_revision_id" as "currentRevisionId",
    revision."revision_number" as "revisionNumber", revision."title", revision."excerpt",
    revision."storage_key" as "storageKey", revision."content_hash" as "contentHash",
    revision."size_bytes" as "sizeBytes", page."created_at" as "createdAt",
    page."updated_at" as "updatedAt"
  from "knowledge_page" page
  join "knowledge_page_revision" revision
    on revision."id" = page."current_revision_id"
   and revision."page_id" = page."id"
   and revision."owner_id" = page."owner_id"
`;

function storedPageFrom(row: StoredPageRow): StoredKnowledgePage {
  return { ...row, revisionNumber: Number(row.revisionNumber), sizeBytes: Number(row.sizeBytes) };
}

function summaryFrom(row: SummaryRow): KnowledgePageSummary {
  return { ...row, revisionNumber: Number(row.revisionNumber) };
}

function revisionSummaryFrom(row: RevisionSummaryRow): KnowledgePageRevisionSummary {
  return { ...row, revisionNumber: Number(row.revisionNumber) };
}

async function resolveLinks({
  db,
  ownerId,
  links,
  self,
}: {
  db: SQL;
  ownerId: string;
  links: KnowledgePageLinkSet;
  self?: { id: string; readableId: string };
}): Promise<
  | {
      state: 'resolved';
      entityIds: string[];
      pageReferences: Array<{ pageId: string; fragment: string | null }>;
    }
  | { state: 'link_target_not_found'; target: string }
> {
  const entityIds: string[] = [];
  for (const readableId of links.entityReadableIds) {
    const rows = await db<Array<{ id: string }>>`
      select "id" from "entity"
      where "owner_id" = ${ownerId} and "readable_id" = ${readableId}
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
    const rows = await db<Array<{ id: string }>>`
      select "id" from "knowledge_page"
      where "owner_id" = ${ownerId} and "readable_id" = ${reference.readableId}
    `;
    if (!rows[0]) {
      return { state: 'link_target_not_found', target: `page/${reference.readableId}` };
    }
    pageReferences.push({ pageId: rows[0].id, fragment: reference.fragment });
  }

  return { state: 'resolved', entityIds, pageReferences };
}

async function insertLinks({
  db,
  ownerId,
  revisionId,
  entityIds,
  pageReferences,
}: {
  db: SQL;
  ownerId: string;
  revisionId: string;
  entityIds: string[];
  pageReferences: Array<{ pageId: string; fragment: string | null }>;
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
}

export class KnowledgePagesRepository
  extends Repository
  implements KnowledgePagesRepositoryContract
{
  create(input: {
    pageId: string;
    revisionId: string;
    ownerId: string;
    readableId: string;
    title: string;
    excerpt: string;
    storageKey: string;
    contentHash: string;
    sizeBytes: number;
    links: KnowledgePageLinkSet;
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

      const createdPages = await db<Array<{ id: string }>>`
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
      await db`
        insert into "knowledge_page_revision"
          ("id", "page_id", "owner_id", "revision_number", "title", "excerpt",
           "storage_key", "size_bytes", "content_hash", "created_at")
        values
          (${input.revisionId}, ${input.pageId}, ${input.ownerId}, 1, ${input.title},
           ${input.excerpt}, ${input.storageKey}, ${input.sizeBytes}, ${input.contentHash},
           ${input.createdAt})
      `;
      await insertLinks({
        db,
        ownerId: input.ownerId,
        revisionId: input.revisionId,
        entityIds: resolved.entityIds,
        pageReferences: resolved.pageReferences,
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
    storageKey: string;
    contentHash: string;
    sizeBytes: number;
    links: KnowledgePageLinkSet;
    updatedAt: string;
  }): Promise<
    | { state: 'updated'; page: StoredKnowledgePage }
    | { state: 'not_found' }
    | { state: 'revision_conflict'; currentRevisionNumber: number }
    | { state: 'link_target_not_found'; target: string }
  > {
    return this.sql.begin(async (db) => {
      const rows = await db.unsafe<StoredPageRow[]>(
        `${CURRENT_PAGE_SELECT} where page."owner_id" = $1 and page."readable_id" = $2`,
        [input.ownerId, input.readableId],
      );
      const current = rows[0] ? storedPageFrom(rows[0]) : null;
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
        insert into "knowledge_page_revision"
          ("id", "page_id", "owner_id", "revision_number", "title", "excerpt",
           "storage_key", "size_bytes", "content_hash", "created_at")
        values
          (${input.revisionId}, ${current.id}, ${input.ownerId}, ${revisionNumber}, ${input.title},
           ${input.excerpt}, ${input.storageKey}, ${input.sizeBytes}, ${input.contentHash},
           ${input.updatedAt})
      `;
      await insertLinks({
        db,
        ownerId: input.ownerId,
        revisionId: input.revisionId,
        entityIds: resolved.entityIds,
        pageReferences: resolved.pageReferences,
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
  }: {
    ownerId: string;
    limit: number;
    offset: number;
    query?: string;
  }) {
    const normalizedQuery = query?.trim() || null;
    const rowsPromise = normalizedQuery
      ? this.sql<SummaryRow[]>`
          select page."id", page."readable_id" as "readableId",
            revision."revision_number" as "revisionNumber", revision."title", revision."excerpt",
            page."created_at" as "createdAt", page."updated_at" as "updatedAt"
          from "knowledge_page" page
          join "knowledge_page_revision" revision on revision."id" = page."current_revision_id"
          where page."owner_id" = ${ownerId}
            and (
              instr(lower(revision."title"), lower(${normalizedQuery})) > 0
              or instr(page."readable_id", lower(${normalizedQuery})) > 0
            )
          order by revision."title" collate nocase, page."readable_id"
          limit ${limit} offset ${offset}
        `
      : this.sql<SummaryRow[]>`
          select page."id", page."readable_id" as "readableId",
            revision."revision_number" as "revisionNumber", revision."title", revision."excerpt",
            page."created_at" as "createdAt", page."updated_at" as "updatedAt"
          from "knowledge_page" page
          join "knowledge_page_revision" revision on revision."id" = page."current_revision_id"
          where page."owner_id" = ${ownerId}
          order by page."updated_at" desc, page."id" desc
          limit ${limit} offset ${offset}
        `;
    const countsPromise = normalizedQuery
      ? this.sql<Array<{ total: number }>>`
          select count(*) as "total"
          from "knowledge_page" page
          join "knowledge_page_revision" revision on revision."id" = page."current_revision_id"
          where page."owner_id" = ${ownerId}
            and (
              instr(lower(revision."title"), lower(${normalizedQuery})) > 0
              or instr(page."readable_id", lower(${normalizedQuery})) > 0
            )
        `
      : this.sql<Array<{ total: number }>>`
          select count(*) as "total" from "knowledge_page" where "owner_id" = ${ownerId}
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
    const rows = await this.sql<SummaryRow[]>`
      select page."id", page."readable_id" as "readableId",
        revision."revision_number" as "revisionNumber", revision."title", revision."excerpt",
        page."created_at" as "createdAt", page."updated_at" as "updatedAt"
      from "entity" entity
      join "knowledge_page_entity_mention" mention
        on mention."target_entity_id" = entity."id" and mention."owner_id" = entity."owner_id"
      join "knowledge_page" page
        on page."current_revision_id" = mention."source_revision_id"
       and page."owner_id" = mention."owner_id"
      join "knowledge_page_revision" revision on revision."id" = page."current_revision_id"
      where entity."owner_id" = ${ownerId} and entity."readable_id" = ${entityReadableId}
      order by page."updated_at" desc, page."id" desc
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
    const rows = await this.sql.unsafe<StoredPageRow[]>(
      `${CURRENT_PAGE_SELECT} where page."owner_id" = $1 and page."readable_id" = $2`,
      [ownerId, readableId],
    );
    return rows[0] ? storedPageFrom(rows[0]) : null;
  }

  async detail({ ownerId, readableId }: { ownerId: string; readableId: string }): Promise<{
    page: StoredKnowledgePage;
    mentions: Entity[];
    references: KnowledgePageReference[];
    backlinks: KnowledgePageReference[];
    revisions: KnowledgePageRevisionSummary[];
  } | null> {
    const page = await this.find({ ownerId, readableId });
    if (!page) {
      return null;
    }
    const [mentions, references, backlinks, revisions] = await Promise.all([
      this.sql<Array<Omit<Entity, 'isSelf'> & { isSelf: number }>>`
        select entity."id", entity."readable_id" as "readableId", entity."name",
          entity."description", profile."self_entity_id" is not null as "isSelf",
          entity."created_at" as "createdAt",
          entity."updated_at" as "updatedAt"
        from "knowledge_page_entity_mention" mention
        join "entity" entity
          on entity."id" = mention."target_entity_id" and entity."owner_id" = mention."owner_id"
        left join "knowledge_profile" profile
          on profile."owner_id" = entity."owner_id" and profile."self_entity_id" = entity."id"
        where mention."owner_id" = ${ownerId}
          and mention."source_revision_id" = ${page.currentRevisionId}
        order by entity."name" collate nocase, entity."readable_id"
      `,
      this.referenceRows({ ownerId, sourceRevisionId: page.currentRevisionId }),
      this.backlinkRows({ ownerId, targetPageId: page.id }),
      this.sql<RevisionSummaryRow[]>`
        select "revision_number" as "revisionNumber", "title", "created_at" as "createdAt"
        from "knowledge_page_revision"
        where "owner_id" = ${ownerId} and "page_id" = ${page.id}
        order by "revision_number" desc
      `,
    ]);
    return {
      page,
      mentions: mentions.map((entity) => ({ ...entity, isSelf: Boolean(entity.isSelf) })),
      references,
      backlinks,
      revisions: revisions.map(revisionSummaryFrom),
    };
  }

  async listCurrent({ ownerId }: { ownerId: string }): Promise<StoredKnowledgePage[]> {
    const rows = await this.sql.unsafe<StoredPageRow[]>(
      `${CURRENT_PAGE_SELECT} where page."owner_id" = $1 order by page."id"`,
      [ownerId],
    );
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
      const pages = await db<Array<{ id: string; currentRevisionId: string }>>`
        select "id", "current_revision_id" as "currentRevisionId"
        from "knowledge_page"
        where "owner_id" = ${ownerId} and "readable_id" = ${readableId}
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
      await insertLinks({
        db,
        ownerId,
        revisionId: page.currentRevisionId,
        entityIds: resolved.entityIds,
        pageReferences: resolved.pageReferences,
      });
      return { state: 'replaced' as const };
    });
  }

  private async referenceRows({
    ownerId,
    sourceRevisionId,
  }: {
    ownerId: string;
    sourceRevisionId: string;
  }): Promise<KnowledgePageReference[]> {
    const rows = await this.sql<Array<SummaryRow & { fragment: string }>>`
      select page."id", page."readable_id" as "readableId",
        revision."revision_number" as "revisionNumber", revision."title", revision."excerpt",
        page."created_at" as "createdAt", page."updated_at" as "updatedAt",
        reference."target_fragment" as "fragment"
      from "knowledge_page_reference" reference
      join "knowledge_page" page
        on page."id" = reference."target_page_id" and page."owner_id" = reference."owner_id"
      join "knowledge_page_revision" revision on revision."id" = page."current_revision_id"
      where reference."owner_id" = ${ownerId}
        and reference."source_revision_id" = ${sourceRevisionId}
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
    const rows = await this.sql<Array<SummaryRow & { fragment: string }>>`
      select page."id", page."readable_id" as "readableId",
        revision."revision_number" as "revisionNumber", revision."title", revision."excerpt",
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
      order by revision."title", page."readable_id", reference."target_fragment"
    `;
    return rows.map(({ fragment, ...row }) => ({
      page: summaryFrom(row),
      fragment: fragment || null,
    }));
  }
}
