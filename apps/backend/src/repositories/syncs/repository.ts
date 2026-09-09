import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type { RecordSync, RecordSyncPrincipal } from '#models/syncs/model.ts';
import type { Queries } from '#queries.gen.ts';

export type CreateRecordSyncResult =
  | { state: 'created'; sync: RecordSync }
  | { state: 'name_conflict' }
  | { state: 'identity_conflict' };

export interface RecordSyncsRepositoryContract {
  create(input: {
    id: string;
    ownerId: string;
    readableId: string;
    name: string;
    apiKeySha256: string;
    createdAt: string;
  }): Promise<CreateRecordSyncResult>;
  list(input: { ownerId: string }): Promise<RecordSync[]>;
  revoke(input: { ownerId: string; readableId: string; revokedAt: string }): Promise<boolean>;
  authenticateApiKeyFingerprint(input: {
    apiKeySha256: string;
  }): Promise<RecordSyncPrincipal | null>;
}

export class RecordSyncsRepository implements RecordSyncsRepositoryContract {
  private readonly sql: TypedSQL<Queries>;

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  async create(input: {
    id: string;
    ownerId: string;
    readableId: string;
    name: string;
    apiKeySha256: string;
    createdAt: string;
  }): Promise<CreateRecordSyncResult> {
    return await this.sql.begin(async (tx) => {
      const names = await tx.FindActiveRecordSyncByName`
        select "id"
        from "record_sync"
        where "owner_id" = ${input.ownerId} and "name" = ${input.name} and "revoked_at" is null
        limit 1
      `;
      if (names[0]) {
        return { state: 'name_conflict' };
      }

      const inserted = await tx.CreateRecordSync`
        insert or ignore into "record_sync"
          ("id", "owner_id", "readable_id", "name", "api_key_sha256", "created_at")
        values
          (${input.id}, ${input.ownerId}, ${input.readableId}, ${input.name},
           ${input.apiKeySha256}, ${input.createdAt})
        returning "id"
      `;
      if (!inserted[0]) {
        return { state: 'identity_conflict' };
      }
      return {
        state: 'created',
        sync: {
          readableId: input.readableId,
          ownerId: input.ownerId,
          name: input.name,
          createdAt: input.createdAt,
          revokedAt: null,
        },
      };
    });
  }

  async list({ ownerId }: { ownerId: string }): Promise<RecordSync[]> {
    return await this.sql.ListRecordSyncs`
      /* @notNull readableId ownerId name createdAt */
      select "readable_id" as "readableId", "owner_id" as "ownerId", "name",
        "created_at" as "createdAt", "revoked_at" as "revokedAt"
      from "record_sync"
      where "owner_id" = ${ownerId}
      order by ("revoked_at" is null) desc, "created_at" desc, "readable_id"
    `;
  }

  async revoke({
    ownerId,
    readableId,
    revokedAt,
  }: {
    ownerId: string;
    readableId: string;
    revokedAt: string;
  }): Promise<boolean> {
    const rows = await this.sql.RevokeRecordSync`
      update "record_sync"
      set "revoked_at" = ${revokedAt}
      where "owner_id" = ${ownerId} and "readable_id" = ${readableId} and "revoked_at" is null
      returning "id"
    `;
    return rows.length > 0;
  }

  async authenticateApiKeyFingerprint({
    apiKeySha256,
  }: {
    apiKeySha256: string;
  }): Promise<RecordSyncPrincipal | null> {
    const rows = await this.sql.AuthenticateRecordSyncApiKey`
      /* @notNull syncId syncReadableId ownerId name */
      select "id" as "syncId", "readable_id" as "syncReadableId",
        "owner_id" as "ownerId", "name"
      from "record_sync"
      where "api_key_sha256" = ${apiKeySha256} and "revoked_at" is null
      limit 1
    `;
    return rows[0] ?? null;
  }
}
