import { expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { createApp } from '#backend/app.ts';
import { type Auth, SESSION_SECURITY_SCHEME } from '#backend/lib/auth/better-auth.ts';
import { API_KEY_SECURITY_SCHEME } from '#backend/routes/api/api-keys/model.ts';
import type { AssetsServiceContract } from '#backend/services/assets/service.ts';
import type { EntitiesServiceContract } from '#backend/services/entities/service.ts';
import type { FrontendAssetsServiceContract } from '#backend/services/frontend-assets/service.ts';
import type { HealthServiceContract } from '#backend/services/health/service.ts';
import type { KnowledgePagesServiceContract } from '#backend/services/knowledge-pages/service.ts';
import type { KnowledgeProfilesServiceContract } from '#backend/services/knowledge-profiles/service.ts';
import type { OwnerRegistrationServiceContract } from '#backend/services/owner-registration/service.ts';
import {
  unusedAssetFacesService,
  unusedHistoryService,
  unusedHypermediaGraphService,
  unusedManagedSyncsService,
  unusedPublicationApprovalService,
  unusedSyncFetch,
} from './support/app.ts';
import {
  testMcpServerUrl,
  unusedAssetTransferCapabilities,
  unusedHypermediaRetrievalService,
  unusedMcpClientAuthorizationsService,
  unusedMcpProtection,
  unusedMcpTransport,
} from './support/mcp.ts';

const PUBLICATION_APPROVAL_PATHS = [
  '/api/publications/approvals',
  '/api/publications/approvals/{approvalId}/complete',
];

function unexpectedCall(): never {
  throw new Error('Unexpected dependency call');
}

test('createApp uses supplied dependencies without production bootstrap', async () => {
  let healthChecks = 0;
  let sessionChecks = 0;
  const auth: Auth = {
    passkeyOrigins: [],
    handler: async () => new Response(null, { status: 404 }),
    getSession: () => {
      sessionChecks += 1;
      return Promise.resolve(null);
    },
    protectMcpRequest: unusedMcpProtection,
  };
  const frontendAssetsService: FrontendAssetsServiceContract = {
    routes: () => new Map<string, Response>(),
    fallback: () => new Response('frontend'),
  };
  const assetsService: AssetsServiceContract = {
    preview: unexpectedCall,
    faces: unusedAssetFacesService,
    create: unexpectedCall,
    list: unexpectedCall,
    detail: unexpectedCall,
    updateName: unexpectedCall,
    archive: unexpectedCall,
    content: unexpectedCall,
  };
  const entitiesService: EntitiesServiceContract = {
    preview: unexpectedCall,
    setImage: unexpectedCall,
    removeImage: unexpectedCall,
    create: unexpectedCall,
    list: unexpectedCall,
    detail: unexpectedCall,
    update: unexpectedCall,
    archive: unexpectedCall,
  };
  const pagesService: KnowledgePagesServiceContract = {
    diff: unexpectedCall,
    create: unexpectedCall,
    list: unexpectedCall,
    preview: unexpectedCall,
    detail: unexpectedCall,
    update: unexpectedCall,
    archive: unexpectedCall,
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
  let acceptedRecordDeliveries = 0;
  const deliveryApiKey = '01991f43-0c00-7000-8000-000000000010';

  const app = createApp({
    publicationApprovalService: unusedPublicationApprovalService,
    publicResourcesService: { assetContent: async () => null },
    historyService: unusedHistoryService,
    managedSyncsService: unusedManagedSyncsService,
    syncFetch: unusedSyncFetch,
    auth,
    assetsService,
    assetTransferCapabilities: unusedAssetTransferCapabilities,
    frontendAssetsService,
    entitiesService,
    healthService,
    graphService: unusedHypermediaGraphService,
    retrievalService: unusedHypermediaRetrievalService,
    mcpClientAuthorizationsService: unusedMcpClientAuthorizationsService,
    mcpServerUrl: testMcpServerUrl,
    mcpTransport: unusedMcpTransport,
    recordsService: {
      remove: unexpectedCall,
      upsert: () => {
        acceptedRecordDeliveries += 1;
        return Promise.resolve({ state: 'created', readableId: 'native-record' });
      },
      findResource: unexpectedCall,
      listResources: unexpectedCall,
      filterOptions: unexpectedCall,
    },
    apiKeysService: {
      authenticate: async ({ apiKey }) =>
        apiKey === deliveryApiKey
          ? {
              keyId: '01991f43-0c00-7000-8000-000000000011',
              name: 'Test key',
              ownerId: 'context-use-owner',
            }
          : null,
      create: unexpectedCall,
      list: unexpectedCall,
      revoke: unexpectedCall,
    },
    ownerRegistrationService,
    pagesService,
    profilesService,
  });
  const response = await app.handle(new Request('http://localhost/api/health'));

  expect(response.status).toBe(StatusMap.OK);
  expect(await response.json()).toEqual({ status: 'ok', uptime: 0 });
  expect(healthChecks).toBe(1);

  await expectPublicRouteBoundary(app);
  expect(sessionChecks).toBe(0);

  const graphResponse = await app.handle(
    new Request(
      `http://localhost/api/map/neighborhoods?${new URLSearchParams({
        anchors: JSON.stringify([{ anchor: { readableId: 'owner' } }]),
      })}`,
    ),
  );
  expect(graphResponse.status).toBe(StatusMap.Unauthorized);

  const receiverResponse = await app.handle(
    new Request('http://localhost/api/records', {
      method: 'POST',
      headers: { authorization: `Bearer ${deliveryApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        changeMessage: 'Imported test record',
        source: { provider: 'github', kind: 'pull-request', id: '1' },
        title: 'Title',
        body: 'Body',
      }),
    }),
  );
  expect(receiverResponse.status).toBe(StatusMap.OK);
  expect(acceptedRecordDeliveries).toBe(1);

  const openApiResponse = await app.handle(new Request('http://localhost/openapi/json'));
  expect(openApiResponse.status).toBe(StatusMap.OK);
  const openApi = (await openApiResponse.json()) as {
    components?: { securitySchemes?: Record<string, unknown> };
    paths?: Record<
      string,
      {
        get?: {
          parameters?: Array<{ in?: string; name?: string; required?: boolean }>;
          requestBody?: unknown;
        };
        post?: {
          parameters?: Array<{ in?: string; name?: string; required?: boolean }>;
          requestBody?: {
            content?: {
              'application/json'?: {
                schema?: { properties?: { records?: { maxItems?: number } } };
              };
            };
          };
          responses?: Record<string, unknown>;
          security?: Array<Record<string, string[]>>;
        };
      }
    >;
  };
  const mapNeighborhoods = openApi.paths?.['/api/map/neighborhoods'];
  expect(mapNeighborhoods?.get?.parameters).toContainEqual(
    expect.objectContaining({ in: 'query', name: 'anchors', required: true }),
  );
  expect(mapNeighborhoods?.get?.requestBody).toBeUndefined();
  expect(mapNeighborhoods?.post).toBeUndefined();
  expect(openApi.paths?.['/api/map/pages']?.get).toBeDefined();
  expect(openApi.paths?.['/api/hypermedia/neighborhoods']).toBeUndefined();
  expect(openApi.paths?.['/api/hypermedia/pages']).toBeUndefined();
  expect(openApi.paths?.['/api/hypermedia/search']?.get).toBeDefined();
  expect(openApi.components?.securitySchemes?.[API_KEY_SECURITY_SCHEME]).toMatchObject({
    type: 'http',
    scheme: 'bearer',
  });
  const receiverOperation = openApi.paths?.['/api/records']?.post;
  expectWriteMessages(openApi.paths ?? {});
  for (const path of PUBLICATION_APPROVAL_PATHS) {
    const operation = openApi.paths?.[path]?.post;
    expect(operation?.security).toEqual([{ [SESSION_SECURITY_SCHEME]: [] }]);
    for (const statusCode of ['200', '400', '401', '404', '409', '500']) {
      expect(operation?.responses).toHaveProperty(statusCode);
    }
  }
  const completeSchema =
    openApi.paths?.['/api/publications/approvals/{approvalId}/complete']?.post?.requestBody
      ?.content?.['application/json']?.schema;
  expect(Object.keys(completeSchema?.properties ?? {})).toEqual(['assertion']);
  expect(completeSchema).toMatchObject({ required: ['assertion'], additionalProperties: false });
  expect(openApi.paths?.['/api/publications/{resourceType}/{readableId}']?.get).toBeDefined();
  expect(receiverOperation?.security).toContainEqual({ [API_KEY_SECURITY_SCHEME]: [] });
  expect(receiverOperation?.requestBody?.content?.['application/json']).toBeDefined();
  expect(openApi.paths?.['/api/records/batch']).toBeUndefined();
  for (const statusCode of ['200', '401', '409']) {
    expect(receiverOperation?.responses).toHaveProperty(statusCode);
  }

  for (const path of ['/mcp', '/mcp/']) {
    const nonPostMcpResponse = await app.handle(new Request(`http://localhost${path}`));
    expect(nonPostMcpResponse.status).toBe(StatusMap['Not Found']);
    expect(await nonPostMcpResponse.json()).toEqual({ error: 'Not Found' });
  }
});

function expectWriteMessages(paths: Record<string, Record<string, unknown>>) {
  type BodySchema = { required?: string[]; allOf?: BodySchema[] };
  const requiresChangeMessage = (schema: BodySchema): boolean =>
    schema.required?.includes('changeMessage') === true ||
    schema.allOf?.some(requiresChangeMessage) === true;
  let mutationContracts = 0;
  for (const [path, operations] of Object.entries(paths)) {
    // Approval ceremonies carry the stored operation and assertion, not content edits.
    if (!path.startsWith('/api/') || PUBLICATION_APPROVAL_PATHS.includes(path)) {
      continue;
    }
    for (const [method, operation] of Object.entries(operations)) {
      if (!['post', 'put', 'patch', 'delete'].includes(method)) {
        continue;
      }
      const contract = operation as {
        requestBody?: { content?: Record<string, { schema?: BodySchema }> };
      };
      const mediaTypes = Object.values(contract.requestBody?.content ?? {});
      expect(
        mediaTypes.length,
        `${method} ${path} must publish its change message`,
      ).toBeGreaterThan(0);
      for (const media of mediaTypes) {
        expect(requiresChangeMessage(media.schema ?? {}), `${method} ${path}`).toBe(true);
      }
      mutationContracts++;
    }
  }
  expect(mutationContracts).toBeGreaterThan(0);
}

async function expectPublicRouteBoundary(app: ReturnType<typeof createApp>) {
  for (const cookie of [undefined, 'better-auth.session_token=owner-session']) {
    for (const path of [
      '/public',
      '/public/',
      '/public/unknown',
      '/public/assets',
      '/public/assets/unknown',
      '/public/assets/unknown/metadata',
    ]) {
      const response = await app.handle(
        new Request(`http://localhost${path}`, { headers: cookie ? { cookie } : {} }),
      );
      expect(response.status).toBe(StatusMap['Not Found']);
      expect(await response.json()).toEqual({ error: 'Not Found' });
    }
    for (const path of ['/pages', '/assets', '/entities', '/publicity', '/public-assets']) {
      const response = await app.handle(
        new Request(`http://localhost${path}`, { headers: cookie ? { cookie } : {} }),
      );
      expect(response.status).toBe(StatusMap.OK);
      expect(await response.text()).toBe('frontend');
    }
  }
}
