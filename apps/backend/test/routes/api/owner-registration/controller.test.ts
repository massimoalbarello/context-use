import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StatusMap } from 'elysia';
import { createApp } from '#app.ts';
import { createSqliteDatabase } from '#db/client.ts';
import { runMigrations } from '#db/migrate.ts';
import type { Auth } from '#lib/auth/better-auth.ts';
import { OWNER_SYNTHETIC_EMAIL, OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import { OwnerRegistrationRepository } from '#repositories/owner-registration/repository.ts';
import type { AssetsServiceContract } from '#services/assets/service.ts';
import type { EntitiesServiceContract } from '#services/entities/service.ts';
import type { FrontendAssetsServiceContract } from '#services/frontend-assets/service.ts';
import type { HealthServiceContract } from '#services/health/service.ts';
import type { KnowledgePagesServiceContract } from '#services/knowledge-pages/service.ts';
import type { KnowledgeProfilesServiceContract } from '#services/knowledge-profiles/service.ts';
import { OwnerRegistrationService } from '#services/owner-registration/service.ts';
import {
  testMcpServerUrl,
  unusedAssetTransferCapabilities,
  unusedMcpClientAuthorizationsService,
  unusedMcpProtection,
  unusedMcpTransport,
} from '../../../support/mcp.ts';

const AUTH_MIGRATION = new URL(
  '../../../../src/db/migrations/0000_better_auth_schema.sql',
  import.meta.url,
);

function unexpectedCall(): never {
  throw new Error('Unexpected dependency call');
}

const auth: Auth = {
  handler: async () => new Response(null, { status: StatusMap['Not Found'] }),
  getSession: async () => null,
  protectMcpRequest: unusedMcpProtection,
};
const frontendAssetsService: FrontendAssetsServiceContract = {
  routes: () => new Map(),
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
const healthService: HealthServiceContract = { check: unexpectedCall };
const pagesService: KnowledgePagesServiceContract = {
  create: unexpectedCall,
  list: unexpectedCall,
  map: unexpectedCall,
  preview: unexpectedCall,
  detail: unexpectedCall,
  update: unexpectedCall,
  archive: unexpectedCall,
  rebuildIndex: unexpectedCall,
};
const profilesService: KnowledgeProfilesServiceContract = {
  create: unexpectedCall,
  find: unexpectedCall,
};

test('owner registration API exposes only complete registration states', async () => {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-owner-registration-test-'));
  const database = await createSqliteDatabase({ dataFolder });

  try {
    await runMigrations({
      db: database,
      migrations: new Map([['0000_better_auth_schema.sql', Bun.file(AUTH_MIGRATION)]]),
    });
    const app = createApp({
      auth,
      assetsService,
      assetTransferCapabilities: unusedAssetTransferCapabilities,
      frontendAssetsService,
      entitiesService,
      healthService,
      mcpClientAuthorizationsService: unusedMcpClientAuthorizationsService,
      mcpServerUrl: testMcpServerUrl,
      mcpTransport: unusedMcpTransport,
      ownerRegistrationService: new OwnerRegistrationService(
        new OwnerRegistrationRepository(database),
      ),
      pagesService,
      profilesService,
    });

    const availableResponse = await app.handle(
      new Request('http://localhost/api/owner-registration'),
    );
    expect(availableResponse.status).toBe(StatusMap.OK);
    expect(await availableResponse.json()).toEqual({ ownerRegistered: false });

    const timestamp = '2026-01-01T00:00:00.000Z';
    await database`
      insert into "auth_user"
        ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
      values
        (${OWNER_USER_ID}, 'Owner', ${OWNER_SYNTHETIC_EMAIL}, 1, ${timestamp}, ${timestamp})
    `;

    const partialResponse = await app.handle(
      new Request('http://localhost/api/owner-registration'),
    );
    expect(partialResponse.status).toBe(StatusMap['Internal Server Error']);
    expect(await partialResponse.json()).toEqual({ error: 'Internal server error' });

    await database`
      insert into "auth_passkey"
        ("id", "name", "publicKey", "userId", "credentialID", "counter", "deviceType",
         "backedUp", "createdAt")
      values
        ('passkey-id', 'Primary passkey', 'public-key', ${OWNER_USER_ID}, 'credential-id', 0,
         'singleDevice', 0, ${timestamp})
    `;

    const registeredResponse = await app.handle(
      new Request('http://localhost/api/owner-registration'),
    );
    expect(registeredResponse.status).toBe(StatusMap.OK);
    expect(await registeredResponse.json()).toEqual({ ownerRegistered: true });
  } finally {
    await database.close();
    await rm(dataFolder, { recursive: true, force: true });
  }
});
