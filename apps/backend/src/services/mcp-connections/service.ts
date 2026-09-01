import { OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import {
  type McpConnectionPrincipal,
  normalizeMcpConnectionName,
} from '#models/mcp-connections/model.ts';
import type { McpConnectionsRepositoryContract } from '#repositories/mcp-connections/repository.ts';

export class McpConnectionsService {
  private readonly connections: McpConnectionsRepositoryContract;

  constructor(connections: McpConnectionsRepositoryContract) {
    this.connections = connections;
  }

  private isOwner(actorId: string): boolean {
    return actorId === OWNER_USER_ID;
  }

  async authorizationClient(input: { actorId: string; clientId: string }) {
    if (!this.isOwner(input.actorId)) {
      return { state: 'forbidden' as const };
    }
    const client = await this.connections.oauthClient({ clientId: input.clientId });
    return client ? { state: 'found' as const, client } : { state: 'not_found' as const };
  }

  async approve(input: { actorId: string; clientId: string; name: string }) {
    if (!this.isOwner(input.actorId)) {
      return { state: 'forbidden' as const };
    }
    const name = normalizeMcpConnectionName(input.name);
    if (!name) {
      return { state: 'invalid' as const };
    }
    const client = await this.connections.oauthClient({ clientId: input.clientId });
    if (!client) {
      return { state: 'not_found' as const };
    }
    const connection = await this.connections.approve({
      id: Bun.randomUUIDv7(),
      ownerId: input.actorId,
      name,
      oauthClientId: client.clientId,
      verifiedClientId: client.verifiedClientId,
      now: new Date().toISOString(),
    });
    return { state: 'approved' as const, connection };
  }

  async list(input: { actorId: string }) {
    if (!this.isOwner(input.actorId)) {
      return { state: 'forbidden' as const };
    }
    return {
      state: 'found' as const,
      connections: await this.connections.list({ ownerId: input.actorId }),
    };
  }

  async rename(input: { actorId: string; connectionId: string; name: string }) {
    if (!this.isOwner(input.actorId)) {
      return { state: 'forbidden' as const };
    }
    const name = normalizeMcpConnectionName(input.name);
    if (!name) {
      return { state: 'invalid' as const };
    }
    const connection = await this.connections.rename({
      ownerId: input.actorId,
      connectionId: input.connectionId,
      name,
      updatedAt: new Date().toISOString(),
    });
    return connection ? { state: 'renamed' as const, connection } : { state: 'not_found' as const };
  }

  async archive(input: { actorId: string; connectionId: string }) {
    if (!this.isOwner(input.actorId)) {
      return { state: 'forbidden' as const };
    }
    const archived = await this.connections.archive({
      ownerId: input.actorId,
      connectionId: input.connectionId,
      archivedAt: new Date().toISOString(),
    });
    return { state: archived ? ('archived' as const) : ('not_found' as const) };
  }

  async authenticate(input: {
    ownerId: string;
    oauthClientId: string;
  }): Promise<McpConnectionPrincipal | null> {
    if (!this.isOwner(input.ownerId)) {
      return null;
    }
    const connection = await this.connections.activePrincipal(input);
    return connection ? { ownerId: connection.ownerId, connectionId: connection.id } : null;
  }
}

export type McpConnectionsServiceContract = Pick<
  McpConnectionsService,
  'authorizationClient' | 'approve' | 'list' | 'rename' | 'archive' | 'authenticate'
>;
