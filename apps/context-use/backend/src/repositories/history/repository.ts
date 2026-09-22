import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type { ResourceChange } from '#backend/models/history/model.ts';
import type { Queries } from '#backend/queries.gen.ts';

export type HistoryPosition = { createdAt: string; sequence: number };
export interface HistoryRepositoryContract {
  list(input: { ownerId: string; limit: number; before?: HistoryPosition }): Promise<{
    items: ResourceChange[];
    next: HistoryPosition | null;
  }>;
}

export class HistoryRepository implements HistoryRepositoryContract {
  private readonly sql: TypedSQL<Queries>;
  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  async list({
    ownerId,
    limit,
    before,
  }: {
    ownerId: string;
    limit: number;
    before?: HistoryPosition;
  }) {
    const rows = await this.sql.ListResourceHistory`
      /* @notNull sequence resourceType readableId name action message details createdAt available */
      select history."sequence", history."resource_type" as "resourceType", history."readable_id" as "readableId",
        history."name", history."action", history."message", history."client_name" as "clientName",
        history."details", history."page_revision_number" as "pageRevisionNumber",
        history."created_at" as "createdAt",
        case history."resource_type"
          when 'entity' then exists (select 1 from "entity" where "owner_id" = ${ownerId} and "readable_id" = history."readable_id" and "archived_at" is null)
          when 'page' then exists (select 1 from "knowledge_page" where "owner_id" = ${ownerId} and "readable_id" = history."readable_id" and "archived_at" is null)
          when 'asset' then exists (select 1 from "asset" where "owner_id" = ${ownerId} and "readable_id" = history."readable_id" and "archived_at" is null)
          when 'record' then exists (select 1 from "record" where "owner_id" = ${ownerId} and "readable_id" = history."readable_id" and "deleted_at" is null)
        end as "available"
      from "resource_change" history
      where history."owner_id" = ${ownerId}
        and (${before?.createdAt ?? null} is null or history."created_at" < ${before?.createdAt ?? null}
          or (history."created_at" = ${before?.createdAt ?? null} and history."sequence" < ${before?.sequence ?? null}))
      order by history."created_at" desc, history."sequence" desc
      limit ${limit + 1}
    `;
    const items: ResourceChange[] = rows.slice(0, limit).map((row) => ({
      sequence: Number(row.sequence),
      resourceType: row.resourceType as ResourceChange['resourceType'],
      readableId: row.readableId,
      name: row.name,
      action: row.action as ResourceChange['action'],
      message: row.message,
      clientName: row.clientName,
      details: JSON.parse(row.details) as string[],
      pageRevisionNumber: row.pageRevisionNumber === null ? null : Number(row.pageRevisionNumber),
      createdAt: row.createdAt,
      available: Boolean(row.available),
    }));
    const last = items.at(-1);
    return {
      items,
      next:
        rows.length > limit && last ? { createdAt: last.createdAt, sequence: last.sequence } : null,
    };
  }
}
