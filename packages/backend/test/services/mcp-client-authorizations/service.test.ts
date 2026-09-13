import { expect, test } from 'bun:test';
import type { McpClientAuthorizationsRepositoryContract } from '#repositories/mcp-client-authorizations/repository.ts';
import { McpClientAuthorizationsService } from '#services/mcp-client-authorizations/service.ts';

test('MCP client authorization management rejects every non-owner actor before persistence', async () => {
  let repositoryCalls = 0;
  const unexpectedCall = () => {
    repositoryCalls += 1;
    throw new Error('A non-owner request reached the repository');
  };
  const service = new McpClientAuthorizationsService({
    oauthClient: unexpectedCall,
    approve: unexpectedCall,
    list: unexpectedCall,
    rename: unexpectedCall,
    archive: unexpectedCall,
    activePrincipal: unexpectedCall,
  } satisfies McpClientAuthorizationsRepositoryContract);

  expect(
    await service.authorizationClient({ actorId: 'another-user', clientId: 'client' }),
  ).toEqual({ state: 'forbidden' });
  expect(
    await service.approve({ actorId: 'another-user', clientId: 'client', name: 'Agent' }),
  ).toEqual({ state: 'forbidden' });
  expect(await service.list({ actorId: 'another-user' })).toEqual({ state: 'forbidden' });
  expect(
    await service.rename({
      actorId: 'another-user',
      clientAuthorizationId: 'client-authorization',
      name: 'Agent',
    }),
  ).toEqual({ state: 'forbidden' });
  expect(
    await service.archive({
      actorId: 'another-user',
      clientAuthorizationId: 'client-authorization',
    }),
  ).toEqual({ state: 'forbidden' });
  expect(
    await service.authenticate({ ownerId: 'another-user', oauthClientId: 'client' }),
  ).toBeNull();
  expect(repositoryCalls).toBe(0);
});
