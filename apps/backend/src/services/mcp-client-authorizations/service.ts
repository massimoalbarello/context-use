import { OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import {
  type McpClientAuthorizationPrincipal,
  normalizeMcpClientName,
} from '#models/mcp-client-authorizations/model.ts';
import type { McpClientAuthorizationsRepositoryContract } from '#repositories/mcp-client-authorizations/repository.ts';

export class McpClientAuthorizationsService {
  private readonly clientAuthorizations: McpClientAuthorizationsRepositoryContract;

  constructor(clientAuthorizations: McpClientAuthorizationsRepositoryContract) {
    this.clientAuthorizations = clientAuthorizations;
  }

  private isOwner(actorId: string): boolean {
    return actorId === OWNER_USER_ID;
  }

  async authorizationClient(input: { actorId: string; clientId: string }) {
    if (!this.isOwner(input.actorId)) {
      return { state: 'forbidden' as const };
    }
    const client = await this.clientAuthorizations.oauthClient({ clientId: input.clientId });
    return client ? { state: 'found' as const, client } : { state: 'not_found' as const };
  }

  async approve(input: { actorId: string; clientId: string; name: string }) {
    if (!this.isOwner(input.actorId)) {
      return { state: 'forbidden' as const };
    }
    const name = normalizeMcpClientName(input.name);
    if (!name) {
      return { state: 'invalid' as const };
    }
    const client = await this.clientAuthorizations.oauthClient({ clientId: input.clientId });
    if (!client) {
      return { state: 'not_found' as const };
    }
    const clientAuthorization = await this.clientAuthorizations.approve({
      id: Bun.randomUUIDv7(),
      ownerId: input.actorId,
      name,
      oauthClientId: client.clientId,
      verifiedClientId: client.verifiedClientId,
      now: new Date().toISOString(),
    });
    return { state: 'approved' as const, clientAuthorization };
  }

  async list(input: { actorId: string }) {
    if (!this.isOwner(input.actorId)) {
      return { state: 'forbidden' as const };
    }
    return {
      state: 'found' as const,
      clientAuthorizations: await this.clientAuthorizations.list({ ownerId: input.actorId }),
    };
  }

  async rename(input: { actorId: string; clientAuthorizationId: string; name: string }) {
    if (!this.isOwner(input.actorId)) {
      return { state: 'forbidden' as const };
    }
    const name = normalizeMcpClientName(input.name);
    if (!name) {
      return { state: 'invalid' as const };
    }
    const clientAuthorization = await this.clientAuthorizations.rename({
      ownerId: input.actorId,
      clientAuthorizationId: input.clientAuthorizationId,
      name,
      updatedAt: new Date().toISOString(),
    });
    return clientAuthorization
      ? { state: 'renamed' as const, clientAuthorization }
      : { state: 'not_found' as const };
  }

  async archive(input: { actorId: string; clientAuthorizationId: string }) {
    if (!this.isOwner(input.actorId)) {
      return { state: 'forbidden' as const };
    }
    const archived = await this.clientAuthorizations.archive({
      ownerId: input.actorId,
      clientAuthorizationId: input.clientAuthorizationId,
      archivedAt: new Date().toISOString(),
    });
    return { state: archived ? ('archived' as const) : ('not_found' as const) };
  }

  async authenticate(input: {
    ownerId: string;
    oauthClientId: string;
  }): Promise<McpClientAuthorizationPrincipal | null> {
    if (!this.isOwner(input.ownerId)) {
      return null;
    }
    const clientAuthorization = await this.clientAuthorizations.activePrincipal(input);
    return clientAuthorization
      ? {
          ownerId: clientAuthorization.ownerId,
          clientAuthorizationId: clientAuthorization.id,
        }
      : null;
  }
}

export type McpClientAuthorizationsServiceContract = Pick<
  McpClientAuthorizationsService,
  'authorizationClient' | 'approve' | 'list' | 'rename' | 'archive' | 'authenticate'
>;
