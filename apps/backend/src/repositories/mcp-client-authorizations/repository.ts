import type { SQL } from 'bun';
import type {
  McpClientAuthorization,
  McpOAuthClient,
} from '#models/mcp-client-authorizations/model.ts';

type McpClientAuthorizationRow = {
  id: string;
  ownerId: string;
  name: string;
  oauthClientId: string;
  verifiedClientId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

type OAuthClientRow = {
  clientId: string;
  clientDiscoveryId: string | null;
  name: string | null;
};

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

function clientAuthorization(row: McpClientAuthorizationRow): McpClientAuthorization {
  return row;
}

export class McpClientAuthorizationsRepository
  implements McpClientAuthorizationsRepositoryContract
{
  private readonly sql: SQL;

  constructor(sql: SQL) {
    this.sql = sql;
  }

  async oauthClient({ clientId }: { clientId: string }): Promise<McpOAuthClient | null> {
    const rows = await this.sql<OAuthClientRow[]>`
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

  async approve(input: {
    id: string;
    ownerId: string;
    name: string;
    oauthClientId: string;
    verifiedClientId: string | null;
    now: string;
  }): Promise<McpClientAuthorization> {
    return await this.sql.begin(async (tx) => {
      const active = await tx<McpClientAuthorizationRow[]>`
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
        where "owner_id" = ${input.ownerId}
          and "oauth_client_id" = ${input.oauthClientId}
          and "archived_at" is null
        limit 1
      `;
      const existing = active[0];
      if (existing) {
        await tx`
          update "mcp_client_authorization"
          set "name" = ${input.name}, "updated_at" = ${input.now}
          where "id" = ${existing.id} and "owner_id" = ${input.ownerId}
        `;
        return clientAuthorization({ ...existing, name: input.name, updatedAt: input.now });
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
    const rows = await this.sql<McpClientAuthorizationRow[]>`
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
    return rows.map(clientAuthorization);
  }

  async rename(input: {
    ownerId: string;
    clientAuthorizationId: string;
    name: string;
    updatedAt: string;
  }): Promise<McpClientAuthorization | null> {
    await this.sql`
      update "mcp_client_authorization"
      set "name" = ${input.name}, "updated_at" = ${input.updatedAt}
      where "id" = ${input.clientAuthorizationId} and "owner_id" = ${input.ownerId}
    `;
    const rows = await this.sql<McpClientAuthorizationRow[]>`
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
      where "id" = ${input.clientAuthorizationId} and "owner_id" = ${input.ownerId}
      limit 1
    `;
    return rows[0] ?? null;
  }

  async archive(input: {
    ownerId: string;
    clientAuthorizationId: string;
    archivedAt: string;
  }): Promise<boolean> {
    return await this.sql.begin(async (tx) => {
      const rows = await tx<{ oauthClientId: string }[]>`
        select "oauth_client_id" as "oauthClientId"
        from "mcp_client_authorization"
        where "id" = ${input.clientAuthorizationId}
          and "owner_id" = ${input.ownerId}
          and "archived_at" is null
        limit 1
      `;
      const row = rows[0];
      if (!row) {
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
        where "clientId" = ${row.oauthClientId}
          and "userId" = ${input.ownerId}
          and "revoked" is null
      `;
      await tx`
        update "auth_oauthAccessToken"
        set "revoked" = ${input.archivedAt}
        where "clientId" = ${row.oauthClientId}
          and "userId" = ${input.ownerId}
          and "revoked" is null
      `;
      await tx`
        delete from "auth_oauthConsent"
        where "clientId" = ${row.oauthClientId} and "userId" = ${input.ownerId}
      `;
      return true;
    });
  }

  async activePrincipal(input: {
    ownerId: string;
    oauthClientId: string;
  }): Promise<McpClientAuthorization | null> {
    const rows = await this.sql<McpClientAuthorizationRow[]>`
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
      where "owner_id" = ${input.ownerId}
        and "oauth_client_id" = ${input.oauthClientId}
        and "archived_at" is null
      limit 1
    `;
    return rows[0] ?? null;
  }
}
