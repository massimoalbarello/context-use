import { expect, test } from 'bun:test';
import type { McpConnectionsRepositoryContract } from '#repositories/mcp-connections/repository.ts';
import { McpConnectionsService } from '#services/mcp-connections/service.ts';

test('MCP connection management rejects every non-owner actor before persistence', async () => {
  let repositoryCalls = 0;
  const unexpectedCall = () => {
    repositoryCalls += 1;
    throw new Error('A non-owner request reached the repository');
  };
  const service = new McpConnectionsService({
    oauthClient: unexpectedCall,
    approve: unexpectedCall,
    list: unexpectedCall,
    rename: unexpectedCall,
    archive: unexpectedCall,
    activePrincipal: unexpectedCall,
  } satisfies McpConnectionsRepositoryContract);

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
      connectionId: 'connection',
      name: 'Agent',
    }),
  ).toEqual({ state: 'forbidden' });
  expect(await service.archive({ actorId: 'another-user', connectionId: 'connection' })).toEqual({
    state: 'forbidden',
  });
  expect(
    await service.authenticate({ ownerId: 'another-user', oauthClientId: 'client' }),
  ).toBeNull();
  expect(repositoryCalls).toBe(0);
});
