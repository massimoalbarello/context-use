import { expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { createApp } from '#app.ts';
import type { Auth } from '#lib/auth/better-auth.ts';
import type { AssetsServiceContract } from '#services/assets/service.ts';
import type { EntitiesServiceContract } from '#services/entities/service.ts';
import type { FrontendAssetsServiceContract } from '#services/frontend-assets/service.ts';
import type { HealthServiceContract } from '#services/health/service.ts';
import type { KnowledgePagesServiceContract } from '#services/knowledge-pages/service.ts';
import type { KnowledgeProfilesServiceContract } from '#services/knowledge-profiles/service.ts';
import type { OwnerRegistrationServiceContract } from '#services/owner-registration/service.ts';
import {
  unusedMcpConnectionsService,
  unusedMcpProtection,
  unusedMcpTransport,
} from './support/mcp.ts';

function unexpectedCall(): never {
  throw new Error('Unexpected dependency call');
}

test('createApp uses supplied dependencies without production bootstrap', async () => {
  let healthChecks = 0;
  const auth: Auth = {
    handler: async () => new Response(null, { status: 404 }),
    getSession: async () => null,
    protectMcpRequest: unusedMcpProtection,
  };
  const frontendAssetsService: FrontendAssetsServiceContract = {
    routes: () => new Map<string, Response>(),
    fallback: () => null,
  };
  const assetsService: AssetsServiceContract = {
    create: unexpectedCall,
    list: unexpectedCall,
    detail: unexpectedCall,
    updateName: unexpectedCall,
    archive: unexpectedCall,
    content: unexpectedCall,
  };
  const entitiesService: EntitiesServiceContract = {
    create: unexpectedCall,
    list: unexpectedCall,
    detail: unexpectedCall,
    update: unexpectedCall,
    setImage: unexpectedCall,
    removeImage: unexpectedCall,
    archive: unexpectedCall,
  };
  const pagesService: KnowledgePagesServiceContract = {
    create: unexpectedCall,
    list: unexpectedCall,
    detail: unexpectedCall,
    update: unexpectedCall,
    archive: unexpectedCall,
    rebuildIndex: unexpectedCall,
  };
  const profilesService: KnowledgeProfilesServiceContract = {
    create: unexpectedCall,
    find: unexpectedCall,
  };
  const ownerRegistrationService: OwnerRegistrationServiceContract = {
    status: unexpectedCall,
  };
  const healthService: HealthServiceContract = {
    check() {
      healthChecks += 1;
      return Promise.resolve({ status: 'ok', uptime: 0 });
    },
  };

  const response = await createApp({
    auth,
    assetsService,
    frontendAssetsService,
    entitiesService,
    healthService,
    mcpConnectionsService: unusedMcpConnectionsService,
    mcpTransport: unusedMcpTransport,
    ownerRegistrationService,
    pagesService,
    profilesService,
  }).handle(new Request('http://localhost/api/health'));

  expect(response.status).toBe(StatusMap.OK);
  expect(await response.json()).toEqual({ status: 'ok', uptime: 0 });
  expect(healthChecks).toBe(1);
});
