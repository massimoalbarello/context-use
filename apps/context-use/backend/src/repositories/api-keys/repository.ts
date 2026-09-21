import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type { ApiKey, ApiKeyPrincipal } from '#backend/models/api-keys/model.ts';
import type { Queries } from '#backend/queries.gen.ts';

export type CreateApiKeyResult =
  | { state: 'created'; key: ApiKey }
  | { state: 'name_conflict' }
  | { state: 'identity_conflict' };

export interface ApiKeysRepositoryContract {
  create(input: {
    id: string;
    ownerId: string;
    readableId: string;
    name: string;
    apiKeySha256: string;
    createdAt: string;
  }): Promise<CreateApiKeyResult>;
  list(input: { ownerId: string }): Promise<ApiKey[]>;
  revoke(input: { ownerId: string; readableId: string; revokedAt: string }): Promise<boolean>;
  authenticateApiKeyFingerprint(input: { apiKeySha256: string }): Promise<ApiKeyPrincipal | null>;
}

export class ApiKeysRepository implements ApiKeysRepositoryContract {
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
  }): Promise<CreateApiKeyResult> {
    return await this.sql.begin(async (tx) => {
      const names = await tx.FindActiveApiKeyByName`
        select "id"
        from "api_key"
        where "owner_id" = ${input.ownerId} and "name" = ${input.name} and "revoked_at" is null
        limit 1
      `;
      if (names[0]) {
        return { state: 'name_conflict' };
      }

      const inserted = await tx.CreateApiKey`
        insert or ignore into "api_key"
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
        key: {
          readableId: input.readableId,
          name: input.name,
          createdAt: input.createdAt,
          revokedAt: null,
        },
      };
    });
  }

  async list({ ownerId }: { ownerId: string }): Promise<ApiKey[]> {
    return await this.sql.ListApiKeys`
      /* @notNull readableId name createdAt */
      select "readable_id" as "readableId", "name", "created_at" as "createdAt",
        "revoked_at" as "revokedAt"
      from "api_key"
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
    const rows = await this.sql.RevokeApiKey`
      update "api_key"
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
  }): Promise<ApiKeyPrincipal | null> {
    const rows = await this.sql.AuthenticateApiKey`
      /* @notNull keyId ownerId */
      select "id" as "keyId", "owner_id" as "ownerId", "name"
      from "api_key"
      where "api_key_sha256" = ${apiKeySha256} and "revoked_at" is null
      limit 1
    `;
    return rows[0] ?? null;
  }
}
