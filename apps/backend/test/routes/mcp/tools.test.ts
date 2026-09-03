import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import type { SQL } from 'bun';
import { createSqliteDatabase } from '#db/client.ts';
import { runMigrations } from '#db/migrate.ts';
import { OWNER_SYNTHETIC_EMAIL, OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import { LocalStorage } from '#lib/storage/local-storage.ts';
import type { Entity } from '#models/entities/model.ts';
import type { KnowledgePage, KnowledgePageReference } from '#models/knowledge-pages/model.ts';
import type { McpClientAuthorizationPrincipal } from '#models/mcp-client-authorizations/model.ts';
import { KnowledgePagesRepository } from '#repositories/knowledge-pages/repository.ts';
import { createContextUseMcpServer } from '#routes/mcp/server.ts';
import type { AssetsServiceContract } from '#services/assets/service.ts';
import type { EntitiesServiceContract } from '#services/entities/service.ts';
import {
  KnowledgePagesService,
  type KnowledgePagesServiceContract,
} from '#services/knowledge-pages/service.ts';
import type { KnowledgeProfilesServiceContract } from '#services/knowledge-profiles/service.ts';
import {
  unusedAssetTransferCapabilities,
  unusedKnowledgeProfilesService,
} from '../../support/mcp.ts';
import { expectNoInternalResourceIds } from '../../support/public-api.ts';

const INTERNAL_ENTITY_ID = '01900000-0000-7000-8000-000000000001';
const INTERNAL_PAGE_ID = '01900000-0000-7000-8000-000000000002';
const INTERNAL_CLIENT_AUTHORIZATION_ID = '01900000-0000-7000-8000-000000000003';
const NOW = '2026-09-01T12:00:00.000Z';
const MAX_HYPERMEDIA_CURATION_GUIDE_WORDS = 650;

function unexpectedCall(): never {
  throw new Error('Unexpected MCP service call');
}

const entity: Entity = {
  id: INTERNAL_ENTITY_ID,
  readableId: 'luca-bianchi',
  name: 'Luca Bianchi',
  description: 'Researcher and collaborator',
  isSelf: false,
  image: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const page: KnowledgePage = {
  id: INTERNAL_PAGE_ID,
  readableId: 'growth-playbook',
  title: 'Growth playbook',
  excerpt: 'Run the feedback loop.',
  temporalCoverage: '2025-03/..',
  revisionNumber: 2,
  createdAt: NOW,
  updatedAt: NOW,
  markdown: '# Growth playbook\n\nRun the feedback loop.',
  mentions: [entity],
  references: [],
  backlinks: [],
  assetUsages: [],
  revisions: [
    {
      revisionNumber: 2,
      title: 'Growth playbook',
      temporalCoverage: '2025-03/..',
      author: { kind: 'mcp_client', name: 'Research agent' },
      createdAt: NOW,
    },
  ],
};

const principal: McpClientAuthorizationPrincipal = {
  ownerId: 'owner-a',
  clientAuthorizationId: INTERNAL_CLIENT_AUTHORIZATION_ID,
  clientAuthorizationName: 'Research agent',
};

const unusedAssetsService: AssetsServiceContract = {
  create: unexpectedCall,
  list: unexpectedCall,
  detail: unexpectedCall,
  updateName: unexpectedCall,
  archive: unexpectedCall,
  content: unexpectedCall,
};

const unusedEntitiesService: EntitiesServiceContract = {
  create: unexpectedCall,
  list: unexpectedCall,
  detail: unexpectedCall,
  update: unexpectedCall,
  setImage: unexpectedCall,
  removeImage: unexpectedCall,
  archive: unexpectedCall,
};

const unusedPagesService: KnowledgePagesServiceContract = {
  create: unexpectedCall,
  list: unexpectedCall,
  preview: unexpectedCall,
  detail: unexpectedCall,
  update: unexpectedCall,
  archive: unexpectedCall,
  rebuildIndex: unexpectedCall,
};

async function withMcpClient<T>({
  actor = principal,
  assetsService = unusedAssetsService,
  entitiesService = unusedEntitiesService,
  pagesService = unusedPagesService,
  profilesService = unusedKnowledgeProfilesService,
  run,
}: {
  actor?: McpClientAuthorizationPrincipal;
  assetsService?: AssetsServiceContract;
  entitiesService?: EntitiesServiceContract;
  pagesService?: KnowledgePagesServiceContract;
  profilesService?: KnowledgeProfilesServiceContract;
  run: (client: Client) => Promise<T>;
}): Promise<T> {
  const server = createContextUseMcpServer({
    principal: actor,
    assetsService,
    entitiesService,
    pagesService,
    profilesService,
    transferCapabilities: unusedAssetTransferCapabilities,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'context-use-test', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

function errorCode(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  const structured = result.structuredContent;
  return structured && typeof structured === 'object' && 'error' in structured
    ? (structured.error as { code?: unknown }).code
    : undefined;
}

async function readHypermediaCurationGuideVersion(client: Client): Promise<string> {
  const result = await client.callTool({ name: 'read_hypermedia_curation_guide' });
  if (result.isError) {
    throw new Error(JSON.stringify(result));
  }
  return (result.structuredContent as { guide_version: string }).guide_version;
}

test('MCP publishes sixteen typed tools with accurate safety annotations and no private coordinates', async () => {
  await withMcpClient({
    run: async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map(({ name }) => name)).toEqual([
        'create_asset_upload',
        'list_assets',
        'read_asset',
        'update_asset',
        'archive_asset',
        'create_entity',
        'list_entities',
        'read_entity',
        'update_entity',
        'archive_entity',
        'read_hypermedia_curation_guide',
        'create_knowledge_page',
        'list_knowledge_pages',
        'read_knowledge_page',
        'update_knowledge_page',
        'archive_knowledge_page',
      ]);
      expect(tools.find(({ name }) => name === 'read_entity')?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      });
      expect(tools.find(({ name }) => name === 'create_entity')?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
      });
      expect(tools.find(({ name }) => name === 'create_entity')?.inputSchema).toMatchObject({
        properties: { isSelf: { type: 'boolean' } },
      });
      expect(tools.find(({ name }) => name === 'archive_entity')?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
      });
      expect(tools.find(({ name }) => name === 'read_entity')?.inputSchema).toMatchObject({
        properties: { address: { pattern: expect.any(String) } },
      });
      expect(tools.find(({ name }) => name === 'read_knowledge_page')?.inputSchema).toMatchObject({
        properties: { address: { pattern: expect.any(String) } },
      });
      expect(tools.find(({ name }) => name === 'read_knowledge_page')?.outputSchema).toMatchObject({
        properties: {
          readableId: { pattern: expect.any(String) },
          temporalCoverage: {},
        },
      });
      const createPageInput = tools.find(
        ({ name }) => name === 'create_knowledge_page',
      )?.inputSchema;
      expect(createPageInput).toMatchObject({
        properties: { temporalCoverage: { description: expect.stringContaining('asserted') } },
      });
      expect(
        Array.isArray(createPageInput?.required) &&
          createPageInput.required.includes('temporalCoverage'),
      ).toBe(false);
      const updatePageTool = tools.find(({ name }) => name === 'update_knowledge_page');
      const updatePageInput = updatePageTool?.inputSchema;
      expect(updatePageTool?.description).toMatch(
        /temporalCoverage.*omit.*preserve.*null.*clear.*value.*replace/,
      );
      expect(updatePageInput).toMatchObject({
        properties: {
          temporalCoverage: { description: expect.stringContaining('omit it to preserve') },
        },
      });
      expect(
        Array.isArray(updatePageInput?.required) &&
          updatePageInput.required.includes('temporalCoverage'),
      ).toBe(false);
      expect(tools.find(({ name }) => name === 'read_hypermedia_curation_guide')).toMatchObject({
        annotations: { readOnlyHint: true, destructiveHint: false },
        inputSchema: { properties: {} },
        outputSchema: {
          properties: {
            guide: { type: 'string' },
            guide_version: { maxLength: 22, minLength: 22 },
          },
        },
      });
      expect(tools.find(({ name }) => name === 'read_asset')?.inputSchema).toMatchObject({
        properties: { address: { pattern: expect.any(String) } },
      });
      expect(
        tools.find(({ name }) => name === 'create_asset_upload')?.inputSchema,
      ).not.toHaveProperty('properties.file');
      const assetToolDescriptions = tools
        .filter(({ name }) => name.includes('asset'))
        .map(({ description }) => description)
        .join(' ');
      expect(assetToolDescriptions).toContain('immutable');
      expect(assetToolDescriptions).toContain('meaningful name');
      expect(assetToolDescriptions).toContain('identity, location, intent, or chronology');
      expect(JSON.stringify(tools)).not.toContain('storageKey');
      expect(JSON.stringify(tools)).not.toContain('uuid');

      const gatedTools = new Set([
        'create_knowledge_page',
        'update_knowledge_page',
        'archive_knowledge_page',
      ]);
      for (const tool of tools) {
        const properties = tool.inputSchema.properties as Record<string, unknown>;
        if (gatedTools.has(tool.name)) {
          expect(properties).toHaveProperty('guide_version');
          expect(tool.inputSchema.required).not.toContain('guide_version');
        } else {
          expect(properties).not.toHaveProperty('guide_version');
        }
      }
    },
  });
});

test('the concise guide is deterministic and names only available retrieval tools', async () => {
  await withMcpClient({
    run: async (client) => {
      const { tools } = await client.listTools();
      const result = await client.callTool({ name: 'read_hypermedia_curation_guide' });
      expect(result.isError).not.toBe(true);
      const { guide, guide_version } = result.structuredContent as {
        guide: string;
        guide_version: string;
      };
      expect(guide_version).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(guide.split(/\s+/).length).toBeLessThanOrEqual(MAX_HYPERMEDIA_CURATION_GUIDE_WORDS);
      expect(guide).toContain('self-writing autobiography');
      expect(guide).toMatch(/where the user\s+and their agents stay in sync/);
      expect(guide).toContain('Do not merely inventory facts');
      expect(guide).toContain('Learn proactively');
      expect(guide).toContain('Begin with retrieval and synthesis, not entities or page titles');
      expect(guide).toContain('Keep the inquiry centered on the user');
      expect(guide).toContain('personal relevance, future utility');
      expect(guide).toContain('ask focused questions rather than guess');
      expect(guide).toMatch(/Fewer well-developed items are better than broad\s+coverage/);
      expect(guide).toContain('Never turn uncertainty into assertion');
      expect(guide).toContain('The autobiography is the graph, not one page');
      expect(guide).toMatch(/Never let a catch-all\s+page grow\s+without bound/);
      expect(guide).toContain('smallest coherent revision');
      expect(guide).toContain('Place knowledge in time');
      expect(guide).toContain('story is derived from its evidence, not a replacement');
      expect(guide).toContain('explain the blockers to the user');
      expect(guide).not.toContain('search_hypermedia');

      const availableToolNames = new Set(tools.map(({ name }) => name));
      const guideToolNames = [...guide.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].flatMap((match) =>
        match[1] ? [match[1]] : [],
      );
      expect(guideToolNames.length).toBeGreaterThan(0);
      expect(guideToolNames.every((toolName) => availableToolNames.has(toolName))).toBe(true);
    },
  });
});

test('page mutations require a current guide version without transport state or version leakage', async () => {
  let currentGuideVersion = '';
  await withMcpClient({
    run: async (client) => {
      currentGuideVersion = await readHypermediaCurationGuideVersion(client);
    },
  });

  const mutationCalls: string[] = [];
  const pagesService: KnowledgePagesServiceContract = {
    ...unusedPagesService,
    create: () => {
      mutationCalls.push('create_knowledge_page');
      return Promise.resolve({ state: 'saved', page });
    },
    update: () => {
      mutationCalls.push('update_knowledge_page');
      return Promise.resolve({ state: 'saved', page });
    },
    archive: () => {
      mutationCalls.push('archive_knowledge_page');
      return Promise.resolve({ state: 'archived' });
    },
  };
  const staleGuideVersion = `${currentGuideVersion.startsWith('A') ? 'B' : 'A'}${currentGuideVersion.slice(1)}`;
  const mutations = [
    {
      name: 'create_knowledge_page',
      arguments: { markdown: page.markdown },
    },
    {
      name: 'update_knowledge_page',
      arguments: {
        address: 'context-use://page/growth-playbook',
        expectedRevisionNumber: 2,
        markdown: page.markdown,
      },
    },
    {
      name: 'archive_knowledge_page',
      arguments: { address: 'context-use://page/growth-playbook' },
    },
  ];

  await withMcpClient({
    pagesService,
    run: async (client) => {
      for (const mutation of mutations) {
        for (const guide_version of [undefined, staleGuideVersion]) {
          const result = await client.callTool({
            name: mutation.name,
            arguments: {
              ...mutation.arguments,
              ...(guide_version ? { guide_version } : {}),
            },
          });
          expect(result.isError).not.toBe(true);
          expect(result.structuredContent).toEqual({
            status: 'action_required',
            code: 'hypermedia_curation_guide_required',
            message:
              'Call read_hypermedia_curation_guide, then retry this tool with the returned guide_version.',
          });
          expect(JSON.stringify(result)).not.toContain(currentGuideVersion);
        }

        const result = await client.callTool({
          name: mutation.name,
          arguments: { ...mutation.arguments, guide_version: currentGuideVersion },
        });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).not.toHaveProperty('guide_version');
      }
    },
  });
  expect(mutationCalls).toEqual(mutations.map(({ name }) => name));
});

test('successful create and update tools return only newly needed coordinates and revision state', async () => {
  const entitiesService: EntitiesServiceContract = {
    ...unusedEntitiesService,
    create: () => Promise.resolve({ state: 'created', entity }),
    update: () => Promise.resolve(entity),
  };
  const pagesService: KnowledgePagesServiceContract = {
    ...unusedPagesService,
    create: () => Promise.resolve({ state: 'saved', page }),
    update: () => Promise.resolve({ state: 'saved', page }),
  };

  await withMcpClient({
    entitiesService,
    pagesService,
    run: async (client) => {
      const createdEntity = await client.callTool({
        name: 'create_entity',
        arguments: { name: entity.name, description: entity.description },
      });
      expect(createdEntity.structuredContent).toEqual({
        address: 'context-use://entity/luca-bianchi',
      });

      const updatedEntity = await client.callTool({
        name: 'update_entity',
        arguments: {
          address: 'context-use://entity/luca-bianchi',
          name: entity.name,
          description: entity.description,
        },
      });
      expect(updatedEntity.structuredContent).toEqual({});

      const guide_version = await readHypermediaCurationGuideVersion(client);
      const createdPage = await client.callTool({
        name: 'create_knowledge_page',
        arguments: { guide_version, markdown: page.markdown },
      });
      expect(createdPage.structuredContent).toEqual({
        address: 'context-use://page/growth-playbook',
        revisionNumber: 2,
      });

      const updatedPage = await client.callTool({
        name: 'update_knowledge_page',
        arguments: {
          address: 'context-use://page/growth-playbook',
          expectedRevisionNumber: 1,
          guide_version,
          markdown: page.markdown,
        },
      });
      expect(updatedPage.structuredContent).toEqual({ revisionNumber: 2 });
    },
  });
});

test('MCP lists are owner-scoped, bounded, cursor-paginated, and reject invalid cursors', async () => {
  const offsets: number[] = [];
  const entitiesService: EntitiesServiceContract = {
    ...unusedEntitiesService,
    list: ({ ownerId, limit, offset }) => {
      expect(ownerId).toBe(principal.ownerId);
      expect(limit).toBe(1);
      offsets.push(offset);
      return Promise.resolve({
        items: [entity],
        total: 2,
        nextOffset: offset === 0 ? 1 : null,
      });
    },
  };

  await withMcpClient({
    entitiesService,
    run: async (client) => {
      const first = await client.callTool({ name: 'list_entities', arguments: { limit: 1 } });
      expect(first.isError).not.toBe(true);
      expectNoInternalResourceIds(first.structuredContent);
      const firstPage = first.structuredContent as {
        nextCursor: string;
        items: Array<{ address: string }>;
      };
      expect(firstPage.items[0]?.address).toBe('context-use://entity/luca-bianchi');
      expect(firstPage.nextCursor).not.toBe('1');

      const wrongList = await client.callTool({
        name: 'list_knowledge_pages',
        arguments: { limit: 1, cursor: firstPage.nextCursor },
      });
      expect(wrongList.isError).toBe(true);
      expect(errorCode(wrongList)).toBe('invalid_cursor');

      const second = await client.callTool({
        name: 'list_entities',
        arguments: { limit: 1, cursor: firstPage.nextCursor },
      });
      expect(second.isError).not.toBe(true);
      expect(offsets).toEqual([0, 1]);

      const invalid = await client.callTool({
        name: 'list_entities',
        arguments: { limit: 1, cursor: 'not-a-cursor' },
      });
      expect(invalid.isError).toBe(true);
      expect(errorCode(invalid)).toBe('invalid_cursor');

      const tampered = await client.callTool({
        name: 'list_entities',
        arguments: { limit: 1, cursor: `${firstPage.nextCursor}!` },
      });
      expect(tampered.isError).toBe(true);
      expect(errorCode(tampered)).toBe('invalid_cursor');
      expect(offsets).toEqual([0, 1]);
    },
  });
});

test('exact typed reads preserve owner-scoped not-found indistinguishability', async () => {
  const owners: string[] = [];
  const entitiesService: EntitiesServiceContract = {
    ...unusedEntitiesService,
    detail: ({ ownerId }) => {
      owners.push(ownerId);
      return Promise.resolve(null);
    },
  };
  const pagesService: KnowledgePagesServiceContract = {
    ...unusedPagesService,
    detail: ({ ownerId }) => {
      owners.push(ownerId);
      return Promise.resolve(null);
    },
  };

  await withMcpClient({
    entitiesService,
    pagesService,
    run: async (client) => {
      const entityResult = await client.callTool({
        name: 'read_entity',
        arguments: { address: 'context-use://entity/private-entity' },
      });
      const pageResult = await client.callTool({
        name: 'read_knowledge_page',
        arguments: { address: 'context-use://page/private-page' },
      });
      expect(errorCode(entityResult)).toBe('not_found');
      expect(errorCode(pageResult)).toBe('not_found');
      expect(owners).toEqual([principal.ownerId, principal.ownerId]);

      const wrongType = await client.callTool({
        name: 'read_entity',
        arguments: { address: 'context-use://page/private-entity' },
      });
      expect(wrongType.isError).toBe(true);
      expect(owners).toEqual([principal.ownerId, principal.ownerId]);
    },
  });
});

test('MCP mutation outcomes retain duplicate retries and stale revision conflicts', async () => {
  const allowDuplicateValues: Array<boolean | undefined> = [];
  const entitiesService: EntitiesServiceContract = {
    ...unusedEntitiesService,
    create: (input) => {
      expect(input.ownerId).toBe(principal.ownerId);
      allowDuplicateValues.push(input.allowDuplicate);
      return Promise.resolve(
        input.allowDuplicate
          ? { state: 'created' as const, entity }
          : { state: 'name_conflict' as const },
      );
    },
  };
  const pagesService: KnowledgePagesServiceContract = {
    ...unusedPagesService,
    update: (input) => {
      expect(input.ownerId).toBe(principal.ownerId);
      expect(input.actor).toEqual({
        kind: 'mcp_client',
        clientAuthorizationId: principal.clientAuthorizationId,
        name: principal.clientAuthorizationName,
      });
      return Promise.resolve({ state: 'revision_conflict', currentRevisionNumber: 2 });
    },
  };

  await withMcpClient({
    entitiesService,
    pagesService,
    run: async (client) => {
      const conflict = await client.callTool({
        name: 'create_entity',
        arguments: { name: entity.name, description: entity.description },
      });
      expect(errorCode(conflict)).toBe('entity_name_conflict');
      const retried = await client.callTool({
        name: 'create_entity',
        arguments: { name: entity.name, description: entity.description, allowDuplicate: true },
      });
      expect(retried.isError).not.toBe(true);
      expectNoInternalResourceIds(retried.structuredContent);
      expect(allowDuplicateValues).toEqual([undefined, true]);

      const stale = await client.callTool({
        name: 'update_knowledge_page',
        arguments: {
          address: 'context-use://page/growth-playbook',
          expectedRevisionNumber: 1,
          guide_version: await readHypermediaCurationGuideVersion(client),
          markdown: page.markdown,
          temporalCoverage: page.temporalCoverage,
        },
      });
      expect(stale.isError).toBe(true);
      expect(stale.structuredContent).toEqual({
        error: expect.objectContaining({
          code: 'revision_conflict',
          address: 'context-use://page/growth-playbook',
          currentRevisionNumber: 2,
        }),
      });
    },
  });
});

test('MCP creates the self entity once through the knowledge profile invariant', async () => {
  let createCalls = 0;
  const selfEntity = { ...entity, isSelf: true };
  const profilesService: KnowledgeProfilesServiceContract = {
    ...unusedKnowledgeProfilesService,
    create: (input) => {
      createCalls += 1;
      expect(input).toEqual({
        ownerId: principal.ownerId,
        name: entity.name,
        description: entity.description,
        allowDuplicate: undefined,
      });
      return Promise.resolve(
        createCalls === 1
          ? { state: 'created' as const, profile: { selfEntity } }
          : { state: 'profile_exists' as const },
      );
    },
  };

  await withMcpClient({
    profilesService,
    run: async (client) => {
      const created = await client.callTool({
        name: 'create_entity',
        arguments: { name: entity.name, description: entity.description, isSelf: true },
      });
      expect(created.isError).not.toBe(true);
      expect(created.structuredContent).toEqual({
        address: 'context-use://entity/luca-bianchi',
      });
      expectNoInternalResourceIds(created.structuredContent);

      const duplicate = await client.callTool({
        name: 'create_entity',
        arguments: { name: entity.name, description: entity.description, isSelf: true },
      });
      expect(errorCode(duplicate)).toBe('self_entity_exists');
      expect(createCalls).toBe(2);
    },
  });
});

test('archive blockers expose public page coordinates and never trigger cascading mutations', async () => {
  let updateCalls = 0;
  const blocker: KnowledgePageReference = {
    page,
    fragment: 'feedback-loop',
  };
  const entitiesService: EntitiesServiceContract = {
    ...unusedEntitiesService,
    archive: () => Promise.resolve({ state: 'resource_in_use', blockers: [blocker] }),
    update: () => {
      updateCalls += 1;
      return Promise.resolve(entity);
    },
  };

  await withMcpClient({
    entitiesService,
    run: async (client) => {
      const result = await client.callTool({
        name: 'archive_entity',
        arguments: { address: 'context-use://entity/luca-bianchi' },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        error: expect.objectContaining({
          code: 'resource_in_use',
          blockers: [
            expect.objectContaining({
              address: 'context-use://page/growth-playbook#feedback-loop',
            }),
          ],
        }),
      });
      expectNoInternalResourceIds(result.structuredContent);
      expect(updateCalls).toBe(0);
    },
  });
});

async function seedMcpAuthorization(database: SQL): Promise<void> {
  await database`
    insert into "auth_user"
      ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
    values
      (${OWNER_USER_ID}, 'Owner', ${OWNER_SYNTHETIC_EMAIL}, 1, ${NOW}, ${NOW})
  `;
  await database`
    insert into "auth_oauthClient"
      ("id", "clientId", "clientDiscoveryId", "name", "redirectUris")
    values ('oauth-row', 'oauth-client', 'cimd', 'Reported client', '[]')
  `;
  await database`
    insert into "mcp_client_authorization"
      ("id", "owner_id", "name", "oauth_client_id", "created_at", "updated_at")
    values
      (${INTERNAL_CLIENT_AUTHORIZATION_ID}, ${OWNER_USER_ID}, 'Research agent', 'oauth-client',
       ${NOW}, ${NOW})
  `;
}

test('knowledge page revisions durably snapshot the acting MCP client authorization name', async () => {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-mcp-tools-test-'));
  const database = await createSqliteDatabase({ dataFolder });
  try {
    await runMigrations({ db: database });
    await seedMcpAuthorization(database);
    const pagesService = new KnowledgePagesService({
      pages: new KnowledgePagesRepository(database),
      storage: new LocalStorage(join(dataFolder, 'objects')),
    });
    const firstActor = { ...principal, ownerId: OWNER_USER_ID };
    let address = '';
    await withMcpClient({
      actor: firstActor,
      pagesService,
      run: async (client) => {
        const guide_version = await readHypermediaCurationGuideVersion(client);
        const created = await client.callTool({
          name: 'create_knowledge_page',
          arguments: {
            guide_version,
            markdown: '# MCP notes\n\nCreated by the research agent.',
            temporalCoverage: '2026-08',
          },
        });
        if (created.isError) {
          throw new Error(JSON.stringify(created));
        }
        expect(created.isError).not.toBe(true);
        address = (created.structuredContent as { address: string }).address;
      },
    });

    await database`
      update "mcp_client_authorization"
      set "name" = 'Renamed research agent', "updated_at" = ${NOW}
      where "id" = ${INTERNAL_CLIENT_AUTHORIZATION_ID} and "owner_id" = ${OWNER_USER_ID}
    `;
    await withMcpClient({
      actor: { ...firstActor, clientAuthorizationName: 'Renamed research agent' },
      pagesService,
      run: async (client) => {
        const guide_version = await readHypermediaCurationGuideVersion(client);
        const updated = await client.callTool({
          name: 'update_knowledge_page',
          arguments: {
            address,
            expectedRevisionNumber: 1,
            guide_version,
            markdown: '# MCP notes\n\nUpdated by the renamed research agent.',
          },
        });
        expect(updated.isError).not.toBe(true);
        expect(updated.structuredContent).toEqual({ revisionNumber: 2 });

        const current = await client.callTool({
          name: 'read_knowledge_page',
          arguments: { address },
        });
        expect(current.isError).not.toBe(true);
        expect(current.structuredContent).toEqual(
          expect.objectContaining({
            revisions: [
              expect.objectContaining({
                temporalCoverage: '2026-08',
                author: { kind: 'mcp_client', name: 'Renamed research agent' },
              }),
              expect.objectContaining({
                temporalCoverage: '2026-08',
                author: { kind: 'mcp_client', name: 'Research agent' },
              }),
            ],
          }),
        );
        expectNoInternalResourceIds(current.structuredContent);
      },
    });

    const rows = await database<
      Array<{
        authorKind: string;
        clientAuthorizationId: string | null;
        authorName: string | null;
      }>
    >`
      select revision."author_kind" as "authorKind",
        revision."author_mcp_client_authorization_id" as "clientAuthorizationId",
        revision."author_name" as "authorName"
      from "knowledge_page_revision" revision
      where revision."owner_id" = ${OWNER_USER_ID}
      order by revision."revision_number"
    `;
    expect(rows).toEqual([
      {
        authorKind: 'mcp_client',
        clientAuthorizationId: INTERNAL_CLIENT_AUTHORIZATION_ID,
        authorName: 'Research agent',
      },
      {
        authorKind: 'mcp_client',
        clientAuthorizationId: INTERNAL_CLIENT_AUTHORIZATION_ID,
        authorName: 'Renamed research agent',
      },
    ]);
  } finally {
    await database.close();
    await rm(dataFolder, { recursive: true, force: true });
  }
});
