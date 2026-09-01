import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type {
  McpClientAuthorization,
  McpOAuthClient,
} from '#models/mcp-client-authorizations/model.ts';
import type { Queries } from '#queries.gen.ts';

export interface McpClientAuthorizationsRepositoryContract {
  oauthClient(input: { clientId: string }): Promise<McpOAuthClient | null>;
  approve(input: {
    id: string;
    ownerId: string;
    name: string;
    oauthClientId: string;
    verifiedClientId: string | null;
    now: string;
  }): Promise<McpClientAuthorization>;
  list(input: { ownerId: string }): Promise<McpClientAuthorization[]>;
  rename(input: {
    ownerId: string;
    clientAuthorizationId: string;
    name: string;
    updatedAt: string;
  }): Promise<McpClientAuthorization | null>;
  archive(input: {
    ownerId: string;
    clientAuthorizationId: string;
    archivedAt: string;
  }): Promise<boolean>;
  activePrincipal(input: {
    ownerId: string;
    oauthClientId: string;
  }): Promise<McpClientAuthorization | null>;
}

export class McpClientAuthorizationsRepository
  implements McpClientAuthorizationsRepositoryContract
{
  private readonly sql: TypedSQL<Queries>;

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  async oauthClient({ clientId }: { clientId: string }): Promise<McpOAuthClient | null> {
    const rows = await this.sql.FindMcpOAuthClient`
      /* @notNull clientId */
      select
        "clientId" as "clientId",
        "clientDiscoveryId" as "clientDiscoveryId",
        "name" as "name"
      from "auth_oauthClient"
      where "clientId" = ${clientId} and coalesce("disabled", 0) = 0
      limit 1
    `;
    const row = rows[0];
    if (!row) {
      return null;
    }
    const verifiedClientId = row.clientDiscoveryId === 'cimd' ? row.clientId : null;
    return {
      clientId: row.clientId,
      verifiedClientId,
      suggestedName: verifiedClientId ? row.name : null,
    };
  }

  private async activeForOAuthClient({
    db,
    ownerId,
    oauthClientId,
  }: {
    db: TypedSQL<Queries>;
    ownerId: string;
    oauthClientId: string;
  }): Promise<McpClientAuthorization | null> {
    const rows = await db.FindActiveMcpClientAuthorization`
      /* @notNull id ownerId name oauthClientId createdAt updatedAt */
      select
        "id",
        "owner_id" as "ownerId",
        "name",
        "oauth_client_id" as "oauthClientId",
        "verified_client_id" as "verifiedClientId",
        "created_at" as "createdAt",
        "updated_at" as "updatedAt",
        "archived_at" as "archivedAt"
      from "mcp_client_authorization"
      where "owner_id" = ${ownerId}
        and "oauth_client_id" = ${oauthClientId}
        and "archived_at" is null
      limit 1
    `;
    return rows[0] ?? null;
  }

  private async activeById({
    db,
    ownerId,
    clientAuthorizationId,
  }: {
    db: TypedSQL<Queries>;
    ownerId: string;
    clientAuthorizationId: string;
  }): Promise<McpClientAuthorization | null> {
    const rows = await db.FindActiveMcpClientAuthorizationById`
      /* @notNull id ownerId name oauthClientId createdAt updatedAt */
      select
        "id",
        "owner_id" as "ownerId",
        "name",
        "oauth_client_id" as "oauthClientId",
        "verified_client_id" as "verifiedClientId",
        "created_at" as "createdAt",
        "updated_at" as "updatedAt",
        "archived_at" as "archivedAt"
      from "mcp_client_authorization"
      where "id" = ${clientAuthorizationId}
        and "owner_id" = ${ownerId}
        and "archived_at" is null
      limit 1
    `;
    return rows[0] ?? null;
  }

  async approve(input: {
    id: string;
    ownerId: string;
    name: string;
    oauthClientId: string;
    verifiedClientId: string | null;
    now: string;
  }): Promise<McpClientAuthorization> {
    return await this.sql.begin(async (tx) => {
      const existing = await this.activeForOAuthClient({
        db: tx,
        ownerId: input.ownerId,
        oauthClientId: input.oauthClientId,
      });
      if (existing) {
        await tx`
          update "mcp_client_authorization"
          set "name" = ${input.name}, "updated_at" = ${input.now}
          where "id" = ${existing.id} and "owner_id" = ${input.ownerId}
        `;
        return { ...existing, name: input.name, updatedAt: input.now };
      }

      await tx`
        insert into "mcp_client_authorization"
          ("id", "owner_id", "name", "oauth_client_id", "verified_client_id", "created_at",
           "updated_at")
        values
          (${input.id}, ${input.ownerId}, ${input.name}, ${input.oauthClientId},
           ${input.verifiedClientId}, ${input.now}, ${input.now})
      `;
      return {
        id: input.id,
        ownerId: input.ownerId,
        name: input.name,
        oauthClientId: input.oauthClientId,
        verifiedClientId: input.verifiedClientId,
        createdAt: input.now,
        updatedAt: input.now,
        archivedAt: null,
      };
    });
  }

  async list({ ownerId }: { ownerId: string }): Promise<McpClientAuthorization[]> {
    return await this.sql.ListMcpClientAuthorizations`
      /* @notNull id ownerId name oauthClientId createdAt updatedAt */
      select
        "id",
        "owner_id" as "ownerId",
        "name",
        "oauth_client_id" as "oauthClientId",
        "verified_client_id" as "verifiedClientId",
        "created_at" as "createdAt",
        "updated_at" as "updatedAt",
        "archived_at" as "archivedAt"
      from "mcp_client_authorization"
      where "owner_id" = ${ownerId}
      order by ("archived_at" is null) desc, "updated_at" desc
    `;
  }

  async rename(input: {
    ownerId: string;
    clientAuthorizationId: string;
    name: string;
    updatedAt: string;
  }): Promise<McpClientAuthorization | null> {
    const rows = await this.sql.RenameActiveMcpClientAuthorization`
      /* @notNull id ownerId name oauthClientId createdAt updatedAt */
      update "mcp_client_authorization"
      set "name" = ${input.name}, "updated_at" = ${input.updatedAt}
      where "id" = ${input.clientAuthorizationId}
        and "owner_id" = ${input.ownerId}
        and "archived_at" is null
      returning
        "id",
        "owner_id" as "ownerId",
        "name",
        "oauth_client_id" as "oauthClientId",
        "verified_client_id" as "verifiedClientId",
        "created_at" as "createdAt",
        "updated_at" as "updatedAt",
        "archived_at" as "archivedAt"
    `;
    return rows[0] ?? null;
  }

  async archive(input: {
    ownerId: string;
    clientAuthorizationId: string;
    archivedAt: string;
  }): Promise<boolean> {
    return await this.sql.begin(async (tx) => {
      const clientAuthorization = await this.activeById({
        db: tx,
        ownerId: input.ownerId,
        clientAuthorizationId: input.clientAuthorizationId,
      });
      if (!clientAuthorization) {
        return false;
      }

      await tx`
        update "mcp_client_authorization"
        set "archived_at" = ${input.archivedAt}, "updated_at" = ${input.archivedAt}
        where "id" = ${input.clientAuthorizationId} and "owner_id" = ${input.ownerId}
      `;
      await tx`
        update "auth_oauthRefreshToken"
        set
          "revoked" = ${input.archivedAt},
          "rotationReplayResponse" = null,
          "rotationReplayExpiresAt" = null
        where "clientId" = ${clientAuthorization.oauthClientId}
          and "userId" = ${input.ownerId}
          and "revoked" is null
      `;
      await tx`
        update "auth_oauthAccessToken"
        set "revoked" = ${input.archivedAt}
        where "clientId" = ${clientAuthorization.oauthClientId}
          and "userId" = ${input.ownerId}
          and "revoked" is null
      `;
      await tx`
        delete from "auth_oauthConsent"
        where "clientId" = ${clientAuthorization.oauthClientId}
          and "userId" = ${input.ownerId}
      `;
      return true;
    });
  }

  async activePrincipal(input: {
    ownerId: string;
    oauthClientId: string;
  }): Promise<McpClientAuthorization | null> {
    return await this.activeForOAuthClient({ db: this.sql, ...input });
  }
}
