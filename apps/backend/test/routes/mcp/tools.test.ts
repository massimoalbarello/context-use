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
import type { EntitiesServiceContract } from '#services/entities/service.ts';
import {
  KnowledgePagesService,
  type KnowledgePagesServiceContract,
} from '#services/knowledge-pages/service.ts';
import { expectNoInternalResourceIds } from '../../support/public-api.ts';

const INTERNAL_ENTITY_ID = '01900000-0000-7000-8000-000000000001';
const INTERNAL_PAGE_ID = '01900000-0000-7000-8000-000000000002';
const INTERNAL_CLIENT_AUTHORIZATION_ID = '01900000-0000-7000-8000-000000000003';
const NOW = '2026-09-01T12:00:00.000Z';

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
  detail: unexpectedCall,
  update: unexpectedCall,
  archive: unexpectedCall,
  rebuildIndex: unexpectedCall,
};

async function withMcpClient<T>({
  actor = principal,
  entitiesService = unusedEntitiesService,
  pagesService = unusedPagesService,
  run,
}: {
  actor?: McpClientAuthorizationPrincipal;
  entitiesService?: EntitiesServiceContract;
  pagesService?: KnowledgePagesServiceContract;
  run: (client: Client) => Promise<T>;
}): Promise<T> {
  const server = createContextUseMcpServer({ principal: actor, entitiesService, pagesService });
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

test('MCP publishes ten typed tools with accurate safety annotations and no private coordinates', async () => {
  await withMcpClient({
    run: async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map(({ name }) => name)).toEqual([
        'create_entity',
        'list_entities',
        'read_entity',
        'update_entity',
        'archive_entity',
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
        properties: { readableId: { pattern: expect.any(String) } },
      });
      expect(JSON.stringify(tools)).not.toContain('storageKey');
      expect(JSON.stringify(tools)).not.toContain('uuid');
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
          markdown: page.markdown,
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
        const created = await client.callTool({
          name: 'create_knowledge_page',
          arguments: { markdown: '# MCP notes\n\nCreated by the research agent.' },
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
        const updated = await client.callTool({
          name: 'update_knowledge_page',
          arguments: {
            address,
            expectedRevisionNumber: 1,
            markdown: '# MCP notes\n\nUpdated by the renamed research agent.',
          },
        });
        expect(updated.isError).not.toBe(true);
        expect(updated.structuredContent).toEqual(
          expect.objectContaining({
            revisions: [
              expect.objectContaining({
                author: { kind: 'mcp_client', name: 'Renamed research agent' },
              }),
              expect.objectContaining({
                author: { kind: 'mcp_client', name: 'Research agent' },
              }),
            ],
          }),
        );
        expectNoInternalResourceIds(updated.structuredContent);
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
