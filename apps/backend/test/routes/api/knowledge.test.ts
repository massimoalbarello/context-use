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
import { LocalStorage } from '#lib/storage/local-storage.ts';
import { READABLE_ID_SUFFIX_LENGTH } from '#models/readable-ids/model.ts';
import { AssetsRepository } from '#repositories/assets/repository.ts';
import { EntitiesRepository } from '#repositories/entities/repository.ts';
import { HealthRepository } from '#repositories/health/repository.ts';
import { KnowledgePagesRepository } from '#repositories/knowledge-pages/repository.ts';
import { KnowledgeProfilesRepository } from '#repositories/knowledge-profiles/repository.ts';
import { OwnerRegistrationRepository } from '#repositories/owner-registration/repository.ts';
import { AssetsService } from '#services/assets/service.ts';
import { EntitiesService } from '#services/entities/service.ts';
import type { FrontendAssetsServiceContract } from '#services/frontend-assets/service.ts';
import { HealthService } from '#services/health/service.ts';
import { KnowledgePagesService } from '#services/knowledge-pages/service.ts';
import { KnowledgeProfilesService } from '#services/knowledge-profiles/service.ts';
import { OwnerRegistrationService } from '#services/owner-registration/service.ts';
import {
  testMcpServerUrl,
  unusedAssetTransferCapabilities,
  unusedMcpClientAuthorizationsService,
  unusedMcpProtection,
  unusedMcpTransport,
} from '../../support/mcp.ts';
import { expectNoInternalResourceIds } from '../../support/public-api.ts';

const AUTH_MIGRATION = new URL(
  '../../../src/db/migrations/0000_better_auth_schema.sql',
  import.meta.url,
);
const KNOWLEDGE_MIGRATION = new URL(
  '../../../src/db/migrations/0001_knowledge.sql',
  import.meta.url,
);
const ENTITY_ARCHIVE_MIGRATION = new URL(
  '../../../src/db/migrations/0002_add_entity_archived_at.sql',
  import.meta.url,
);
const PAGE_ARCHIVE_MIGRATION = new URL(
  '../../../src/db/migrations/0003_add_knowledge_page_archived_at.sql',
  import.meta.url,
);
const ARCHIVE_INVARIANT_MIGRATION = new URL(
  '../../../src/db/migrations/0004_prevent_self_entity_archiving.sql',
  import.meta.url,
);
const ASSET_MIGRATION = new URL('../../../src/db/migrations/0005_add_assets.sql', import.meta.url);
const OAUTH_MIGRATION = new URL(
  '../../../src/db/migrations/0006_add_oauth_provider.sql',
  import.meta.url,
);
const MCP_CLIENT_AUTHORIZATION_MIGRATION = new URL(
  '../../../src/db/migrations/0007_add_mcp_client_authorizations.sql',
  import.meta.url,
);
const EXPECTED_ENTITY_COUNT = 4;
const EXPECTED_PAGE_COUNT = 5;
const EXPECTED_SECOND_PAGE_OFFSET = 4;
const EXPECTED_FILTERED_PAGE_COUNT = 5;
const EXPECTED_GROWTH_REVISION_COUNT = 3;
const EXPECTED_CURRENT_MENTION_COUNT = 4;

const frontendAssetsService: FrontendAssetsServiceContract = {
  routes: () => new Map(),
  fallback: () => null,
};

function ownerAuth(): Auth {
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  return {
    handler: async () => new Response(null, { status: StatusMap['Not Found'] }),
    getSession: async () => ({
      user: {
        id: OWNER_USER_ID,
        name: 'Owner',
        email: OWNER_SYNTHETIC_EMAIL,
        emailVerified: true,
        createdAt,
        updatedAt: createdAt,
      },
      session: {
        id: 'session-id',
        userId: OWNER_USER_ID,
        token: 'session-token',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        createdAt,
        updatedAt: createdAt,
      },
    }),
    protectMcpRequest: unusedMcpProtection,
  };
}

function jsonRequest({
  method,
  path,
  body,
}: {
  method: string;
  path: string;
  body?: unknown;
}): Request {
  return new Request(`http://localhost/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('entity and page APIs maintain a rebuildable, owner-scoped hypermedia graph', async () => {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-knowledge-test-'));
  const database = await createSqliteDatabase({ dataFolder });

  try {
    await runMigrations({
      db: database,
      migrations: new Map([
        ['0000_better_auth_schema.sql', Bun.file(AUTH_MIGRATION)],
        ['0001_knowledge.sql', Bun.file(KNOWLEDGE_MIGRATION)],
        ['0002_add_entity_archived_at.sql', Bun.file(ENTITY_ARCHIVE_MIGRATION)],
        ['0003_add_knowledge_page_archived_at.sql', Bun.file(PAGE_ARCHIVE_MIGRATION)],
        ['0004_prevent_self_entity_archiving.sql', Bun.file(ARCHIVE_INVARIANT_MIGRATION)],
        ['0005_add_assets.sql', Bun.file(ASSET_MIGRATION)],
        ['0006_add_oauth_provider.sql', Bun.file(OAUTH_MIGRATION)],
        ['0007_add_mcp_client_authorizations.sql', Bun.file(MCP_CLIENT_AUTHORIZATION_MIGRATION)],
      ]),
    });
    const timestamp = '2026-01-01T00:00:00.000Z';
    await database`
      insert into "auth_user"
        ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
      values
        (${OWNER_USER_ID}, 'Owner', ${OWNER_SYNTHETIC_EMAIL}, 1, ${timestamp}, ${timestamp})
    `;

    const pagesRepository = new KnowledgePagesRepository(database);
    const assetsRepository = new AssetsRepository(database);
    const entitiesRepository = new EntitiesRepository(database);
    const storage = new LocalStorage(join(dataFolder, 'objects'));
    const pagesService = new KnowledgePagesService({
      pages: pagesRepository,
      storage,
    });
    const app = createApp({
      auth: ownerAuth(),
      assetsService: new AssetsService({ assets: assetsRepository, storage }),
      assetTransferCapabilities: unusedAssetTransferCapabilities,
      frontendAssetsService,
      entitiesService: new EntitiesService({
        assets: assetsRepository,
        entities: entitiesRepository,
        pages: pagesRepository,
      }),
      healthService: new HealthService(new HealthRepository(database)),
      mcpClientAuthorizationsService: unusedMcpClientAuthorizationsService,
      mcpServerUrl: testMcpServerUrl,
      mcpTransport: unusedMcpTransport,
      ownerRegistrationService: new OwnerRegistrationService(
        new OwnerRegistrationRepository(database),
      ),
      pagesService,
      profilesService: new KnowledgeProfilesService(new KnowledgeProfilesRepository(database)),
    });

    const profileResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/profile',
        body: {
          name: 'Test Owner',
          description: 'The person whose private knowledge base this is.',
        },
      }),
    );
    expect(profileResponse.status).toBe(StatusMap.Created);
    expectNoInternalResourceIds(await profileResponse.clone().json());
    expect(await profileResponse.json()).toEqual({
      selfEntity: expect.objectContaining({
        readableId: 'test-owner',
        name: 'Test Owner',
        isSelf: true,
      }),
    });

    const updatedProfileEntityResponse = await app.handle(
      jsonRequest({
        method: 'PATCH',
        path: '/entities/test-owner',
        body: {
          name: 'Test Owner',
          description: 'The person represented as self inside this private knowledge base.',
        },
      }),
    );
    expect(updatedProfileEntityResponse.status).toBe(StatusMap.OK);
    expect(await updatedProfileEntityResponse.json()).toEqual(
      expect.objectContaining({ readableId: 'test-owner', isSelf: true }),
    );

    const nonAsciiNameResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/entities',
        body: {
          name: '東京',
          description: 'A place whose name still receives a stable derived address.',
        },
      }),
    );
    expect(nonAsciiNameResponse.status).toBe(StatusMap.Created);
    expect(await nonAsciiNameResponse.json()).toEqual(
      expect.objectContaining({ readableId: 'u-6771-4eac', name: '東京' }),
    );

    const entityResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/entities',
        body: {
          name: 'Luca Bianchi',
          description: 'Product lead.',
        },
      }),
    );
    expect(entityResponse.status).toBe(StatusMap.Created);
    expectNoInternalResourceIds(await entityResponse.json());

    const entityConflictResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/entities',
        body: {
          name: 'Luca Bianchi',
          description: 'A different person with the same name and a distinct role.',
        },
      }),
    );
    expect(entityConflictResponse.status).toBe(StatusMap.Conflict);
    expect(await entityConflictResponse.json()).toEqual({
      error:
        'An entity with this name already exists. Use a more specific name or keep this name anyway.',
      nameConflict: true,
    });

    const distinguishedEntityResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/entities',
        body: {
          name: 'Luca Bianchi',
          description: 'A different person with the same name and a distinct role.',
          allowDuplicate: true,
        },
      }),
    );
    expect(distinguishedEntityResponse.status).toBe(StatusMap.Created);
    const distinguishedEntity = (await distinguishedEntityResponse.json()) as {
      readableId: string;
    };
    expect(distinguishedEntity.readableId).toMatch(/^luca-bianchi-[a-f0-9]{6}$/);

    const firstEntityPageResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/entities?limit=2&offset=0' }),
    );
    expect(firstEntityPageResponse.status).toBe(StatusMap.OK);
    const firstEntityPage = (await firstEntityPageResponse.json()) as {
      items: Array<{ readableId: string }>;
      total: number;
      nextOffset: number | null;
    };
    expect(firstEntityPage.items).toHaveLength(2);
    expect(firstEntityPage.total).toBe(EXPECTED_ENTITY_COUNT);
    expect(firstEntityPage.nextOffset).toBe(2);

    const secondEntityPageResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/entities?limit=2&offset=2' }),
    );
    const secondEntityPage = (await secondEntityPageResponse.json()) as {
      items: Array<{ readableId: string }>;
      total: number;
      nextOffset: number | null;
    };
    expect(secondEntityPage.items).toHaveLength(2);
    expect(secondEntityPage.total).toBe(EXPECTED_ENTITY_COUNT);
    expect(secondEntityPage.nextOffset).toBeNull();
    expect(secondEntityPage.items[0]?.readableId).not.toBe(firstEntityPage.items[0]?.readableId);
    expect(secondEntityPage.items[0]?.readableId).not.toBe(firstEntityPage.items[1]?.readableId);
    expectNoInternalResourceIds(firstEntityPage);
    expectNoInternalResourceIds(secondEntityPage);

    const searchedEntityPageResponse = await app.handle(
      jsonRequest({
        method: 'GET',
        path: `/entities?limit=7&offset=0&query=${distinguishedEntity.readableId.slice(-READABLE_ID_SUFFIX_LENGTH)}`,
      }),
    );
    expect(await searchedEntityPageResponse.json()).toEqual({
      items: [expect.objectContaining({ readableId: distinguishedEntity.readableId })],
      total: 1,
      nextOffset: null,
    });

    const timelineEntityResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/entities',
        body: { name: 'Timeline subject', description: 'Subject used to verify related history.' },
      }),
    );
    expect(timelineEntityResponse.status).toBe(StatusMap.Created);

    const growthResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/pages',
        body: {
          temporalCoverage: '2025-03/2025-08',
          markdown: `# Growth playbook

[Luca](context-use://entity/luca-bianchi) owns this feedback system.

## Feedback loop

Every observation changes the next action.`,
        },
      }),
    );
    expect(growthResponse.status).toBe(StatusMap.Created);
    const growth = (await growthResponse.json()) as {
      excerpt: string;
      temporalCoverage: string | null;
      revisionNumber: number;
      mentions: Array<{ readableId: string }>;
    };
    expectNoInternalResourceIds(growth);
    expect(growth.excerpt).toBe('Luca owns this feedback system.');
    expect(growth.temporalCoverage).toBe('2025-03/2025-08');
    expect(growth.revisionNumber).toBe(1);
    expect(growth.mentions.map(({ readableId }) => readableId)).toEqual(['luca-bianchi']);

    const invalidTemporalCoverageResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/pages',
        body: {
          markdown: '# Impossible date\n\nThis page must not be stored.',
          temporalCoverage: '2026-02-29',
        },
      }),
    );
    expect(invalidTemporalCoverageResponse.status).toBe(StatusMap['Bad Request']);
    expect(await invalidTemporalCoverageResponse.json()).toEqual({
      error: expect.stringContaining('Use YYYY'),
    });

    const pageConflictResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/pages',
        body: { markdown: '# Growth playbook\n\nA different page with the same title.' },
      }),
    );
    expect(pageConflictResponse.status).toBe(StatusMap.Conflict);
    expect(await pageConflictResponse.json()).toEqual({
      error:
        'A page with this title already exists. Use a more specific title or keep this title anyway.',
      nameConflict: true,
    });

    const duplicatePageResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/pages',
        body: {
          markdown: '# Growth playbook\n\nA different page with the same title.',
          allowDuplicate: true,
        },
      }),
    );
    expect(duplicatePageResponse.status).toBe(StatusMap.Created);
    const duplicatePage = (await duplicatePageResponse.json()) as { readableId: string };
    expect(duplicatePage.readableId).toMatch(/^growth-playbook-[a-f0-9]{6}$/);

    const rhythmResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/pages',
        body: {
          temporalCoverage: '2025~',
          markdown: `# Operating rhythm

[Timeline subject](context-use://entity/timeline-subject) uses the [feedback loop](context-use://page/growth-playbook#feedback-loop) every Friday.`,
        },
      }),
    );
    expect(rhythmResponse.status).toBe(StatusMap.Created);

    const ongoingResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/pages',
        body: {
          temporalCoverage: '2024-11?/..',
          markdown:
            '# Current programme\n\n[Timeline subject](context-use://entity/timeline-subject) remains evidenced and ongoing.',
        },
      }),
    );
    expect(ongoingResponse.status).toBe(StatusMap.Created);

    const generalResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/pages',
        body: {
          markdown:
            '# Alpha principles\n\n[Timeline subject](context-use://entity/timeline-subject) has general guidance with no asserted subject time.',
        },
      }),
    );
    expect(generalResponse.status).toBe(StatusMap.Created);

    const firstKnowledgePageResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/pages?limit=2&offset=0' }),
    );
    const firstKnowledgePage = (await firstKnowledgePageResponse.json()) as {
      items: Array<{ readableId: string }>;
      total: number;
      nextOffset: number | null;
    };
    expect(firstKnowledgePage.items).toHaveLength(2);
    expect(firstKnowledgePage.total).toBe(EXPECTED_PAGE_COUNT);
    expect(firstKnowledgePage.nextOffset).toBe(2);
    expect(firstKnowledgePage.items.map(({ readableId }) => readableId)).toEqual([
      'current-programme',
      'operating-rhythm',
    ]);

    const secondKnowledgePageResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/pages?limit=2&offset=2' }),
    );
    const secondKnowledgePage = (await secondKnowledgePageResponse.json()) as {
      items: Array<{ readableId: string }>;
      total: number;
      nextOffset: number | null;
    };
    expect(secondKnowledgePage.items).toHaveLength(2);
    expect(secondKnowledgePage.total).toBe(EXPECTED_PAGE_COUNT);
    expect(secondKnowledgePage.nextOffset).toBe(EXPECTED_SECOND_PAGE_OFFSET);
    expect(secondKnowledgePage.items.map(({ readableId }) => readableId)).toEqual([
      'growth-playbook',
      'alpha-principles',
    ]);
    const thirdKnowledgePageResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/pages?limit=2&offset=4' }),
    );
    const thirdKnowledgePage = (await thirdKnowledgePageResponse.json()) as {
      items: Array<{ readableId: string }>;
      total: number;
      nextOffset: number | null;
    };
    expect(thirdKnowledgePage.items.map(({ readableId }) => readableId)).toEqual([
      duplicatePage.readableId,
    ]);
    expect(thirdKnowledgePage.total).toBe(EXPECTED_PAGE_COUNT);
    expect(thirdKnowledgePage.nextOffset).toBeNull();
    expectNoInternalResourceIds(firstKnowledgePage);
    expectNoInternalResourceIds(secondKnowledgePage);
    expectNoInternalResourceIds(thirdKnowledgePage);
    expect(
      [
        ...firstKnowledgePage.items.map(({ readableId }) => readableId),
        ...secondKnowledgePage.items.map(({ readableId }) => readableId),
        ...thirdKnowledgePage.items.map(({ readableId }) => readableId),
      ].sort(),
    ).toEqual(
      [
        'alpha-principles',
        'current-programme',
        'growth-playbook',
        duplicatePage.readableId,
        'operating-rhythm',
      ].sort(),
    );

    const overlappingPagesResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/pages?limit=2&offset=0&time=2025-04' }),
    );
    const overlappingPages = (await overlappingPagesResponse.json()) as {
      items: Array<{ readableId: string }>;
      total: number;
      nextOffset: number | null;
    };
    expect(overlappingPages.items.map(({ readableId }) => readableId)).toEqual([
      'current-programme',
      'operating-rhythm',
    ]);
    expect(overlappingPages.total).toBe(EXPECTED_FILTERED_PAGE_COUNT);
    expect(overlappingPages.nextOffset).toBe(2);

    const remainingOverlappingPagesResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/pages?limit=2&offset=2&time=2025-04' }),
    );
    expect(await remainingOverlappingPagesResponse.json()).toEqual({
      items: [
        expect.objectContaining({ readableId: 'growth-playbook' }),
        expect.objectContaining({ readableId: 'alpha-principles' }),
      ],
      total: EXPECTED_FILTERED_PAGE_COUNT,
      nextOffset: 4,
    });

    const finalOverlappingPagesResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/pages?limit=2&offset=4&time=2025-04' }),
    );
    expect(await finalOverlappingPagesResponse.json()).toEqual({
      items: [expect.objectContaining({ readableId: duplicatePage.readableId })],
      total: EXPECTED_FILTERED_PAGE_COUNT,
      nextOffset: null,
    });

    const futurePagesResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/pages?time=2026' }),
    );
    expect(await futurePagesResponse.json()).toEqual({
      items: [
        expect.objectContaining({ readableId: 'current-programme' }),
        expect.objectContaining({ readableId: 'alpha-principles' }),
        expect.objectContaining({ readableId: duplicatePage.readableId }),
      ],
      total: 3,
      nextOffset: null,
    });

    const noOverlapResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/pages?time=2024-01/2024-10' }),
    );
    expect(await noOverlapResponse.json()).toEqual({
      items: [
        expect.objectContaining({ readableId: 'alpha-principles' }),
        expect.objectContaining({ readableId: duplicatePage.readableId }),
      ],
      total: 2,
      nextOffset: null,
    });

    const invalidTimeFilterResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/pages?time=2025-13' }),
    );
    expect(invalidTimeFilterResponse.status).toBe(StatusMap['Bad Request']);
    expect(await invalidTimeFilterResponse.json()).toEqual({
      error: expect.stringContaining('Use YYYY'),
    });

    const timelineEntityDetailResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/entities/timeline-subject' }),
    );
    const timelineEntityDetail = (await timelineEntityDetailResponse.json()) as {
      pages: Array<{ readableId: string }>;
    };
    expect(timelineEntityDetail.pages.map(({ readableId }) => readableId)).toEqual([
      'current-programme',
      'operating-rhythm',
      'alpha-principles',
    ]);

    const searchedKnowledgePageResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/pages?limit=7&offset=0&query=growth' }),
    );
    expect(await searchedKnowledgePageResponse.json()).toEqual({
      items: [
        expect.objectContaining({
          readableId: 'growth-playbook',
          excerpt: 'Luca owns this feedback system.',
        }),
        expect.objectContaining({
          readableId: duplicatePage.readableId,
          excerpt: 'A different page with the same title.',
        }),
      ],
      total: 2,
      nextOffset: null,
    });

    const linkedGrowthResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/pages/growth-playbook' }),
    );
    const linkedGrowth = (await linkedGrowthResponse.json()) as {
      backlinks: Array<{ page: { readableId: string }; fragment: string | null }>;
    };
    expectNoInternalResourceIds(linkedGrowth);
    expect(linkedGrowth.backlinks).toEqual([
      {
        page: expect.objectContaining({ readableId: 'operating-rhythm' }),
        fragment: 'feedback-loop',
      },
    ]);

    const renamedOwnerResponse = await app.handle(
      jsonRequest({
        method: 'PATCH',
        path: '/entities/test-owner',
        body: {
          name: 'Renamed Test Owner',
          description: 'The person represented as self inside this private knowledge base.',
        },
      }),
    );
    expect(renamedOwnerResponse.status).toBe(StatusMap.OK);

    const updateResponse = await app.handle(
      jsonRequest({
        method: 'PUT',
        path: '/pages/growth-playbook',
        body: {
          expectedRevisionNumber: 1,
          markdown: `# Growth playbook

[Luca](context-use://entity/luca-bianchi) owns the live account.

## Feedback loop

Revise the current knowledge instead of appending snapshots.`,
        },
      }),
    );
    expect(updateResponse.status).toBe(StatusMap.OK);
    const updatedPage = (await updateResponse.json()) as {
      excerpt: string;
      revisionNumber: number;
      revisions: Array<{
        revisionNumber: number;
        title: string;
        temporalCoverage: string | null;
        author: { kind: 'owner' | 'mcp_client'; name: string };
      }>;
    };
    expect(updatedPage.revisionNumber).toBe(2);
    expect(updatedPage.excerpt).toBe('Luca owns the live account.');
    expect(updatedPage.revisions).toEqual([
      expect.objectContaining({
        revisionNumber: 2,
        title: 'Growth playbook',
        temporalCoverage: '2025-03/2025-08',
        author: { kind: 'owner', name: 'Renamed Test Owner' },
      }),
      expect.objectContaining({
        revisionNumber: 1,
        title: 'Growth playbook',
        temporalCoverage: '2025-03/2025-08',
        author: { kind: 'owner', name: 'Test Owner' },
      }),
    ]);
    const currentMentionCount = await database<Array<{ count: number }>>`
      select count(*) as "count" from "knowledge_page_entity_mention"
    `;
    expect(Number(currentMentionCount[0]?.count)).toBe(EXPECTED_CURRENT_MENTION_COUNT);

    const staleUpdateResponse = await app.handle(
      jsonRequest({
        method: 'PUT',
        path: '/pages/growth-playbook',
        body: {
          expectedRevisionNumber: 1,
          markdown: '# Stale edit\n\nThis edit is based on an old revision.',
        },
      }),
    );
    expect(staleUpdateResponse.status).toBe(StatusMap.Conflict);

    await database`delete from "knowledge_page_entity_mention"`;
    await database`delete from "knowledge_page_reference"`;
    await database`
      update "knowledge_page_revision"
      set "excerpt" = 'stale derived excerpt'
      where "id" = (
        select "current_revision_id" from "knowledge_page"
        where "owner_id" = ${OWNER_USER_ID} and "readable_id" = 'growth-playbook'
      )
    `;
    await pagesService.rebuildIndex({ ownerId: OWNER_USER_ID });

    const rebuiltResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/pages/growth-playbook' }),
    );
    const rebuilt = (await rebuiltResponse.json()) as {
      excerpt: string;
      mentions: Array<{ readableId: string }>;
      backlinks: Array<{ page: { readableId: string } }>;
    };
    expect(rebuilt.excerpt).toBe('Luca owns the live account.');
    expect(rebuilt.mentions.map(({ readableId }) => readableId)).toEqual(['luca-bianchi']);
    expect(rebuilt.backlinks.map(({ page }) => page.readableId)).toEqual(['operating-rhythm']);

    const entityDetailResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/entities/luca-bianchi' }),
    );
    expect(entityDetailResponse.status).toBe(StatusMap.OK);
    expectNoInternalResourceIds(await entityDetailResponse.clone().json());
    expect(
      ((await entityDetailResponse.json()) as { pages: Array<{ readableId: string }> }).pages.map(
        ({ readableId }) => readableId,
      ),
    ).toEqual(['growth-playbook']);

    expect(
      await entitiesRepository.archive({
        ownerId: 'someone-else',
        readableId: 'luca-bianchi',
        archivedAt: timestamp,
      }),
    ).toEqual({ state: 'not_found' });
    expect(
      await pagesRepository.archive({
        ownerId: 'someone-else',
        readableId: 'growth-playbook',
        archivedAt: timestamp,
      }),
    ).toEqual({ state: 'not_found' });

    const selfArchiveResponse = await app.handle(
      jsonRequest({
        method: 'PUT',
        path: '/entities/test-owner/archive',
      }),
    );
    expect(selfArchiveResponse.status).toBe(StatusMap.Conflict);

    const blockedEntityArchiveResponse = await app.handle(
      jsonRequest({
        method: 'PUT',
        path: '/entities/luca-bianchi/archive',
      }),
    );
    expect(blockedEntityArchiveResponse.status).toBe(StatusMap.Conflict);
    expectNoInternalResourceIds(await blockedEntityArchiveResponse.clone().json());
    expect(await blockedEntityArchiveResponse.json()).toEqual({
      error: 'Remove or replace every active inbound relationship before archiving this resource.',
      blockers: [
        {
          page: expect.objectContaining({ readableId: 'growth-playbook' }),
          fragment: null,
        },
      ],
    });

    const blockedPageArchiveResponse = await app.handle(
      jsonRequest({
        method: 'PUT',
        path: '/pages/growth-playbook/archive',
      }),
    );
    expect(blockedPageArchiveResponse.status).toBe(StatusMap.Conflict);
    expectNoInternalResourceIds(await blockedPageArchiveResponse.clone().json());
    expect(await blockedPageArchiveResponse.json()).toEqual({
      error: 'Remove or replace every active inbound relationship before archiving this resource.',
      blockers: [
        {
          page: expect.objectContaining({ readableId: 'operating-rhythm' }),
          fragment: 'feedback-loop',
        },
      ],
    });

    const removeEntityUsageResponse = await app.handle(
      jsonRequest({
        method: 'PUT',
        path: '/pages/growth-playbook',
        body: {
          expectedRevisionNumber: 2,
          temporalCoverage: '2025-03/..',
          markdown: `# Growth playbook

[Test Owner](context-use://entity/test-owner) owns the live account.

## Feedback loop

Revise the current knowledge instead of appending snapshots. Compare the [alternative](context-use://page/${duplicatePage.readableId}).`,
        },
      }),
    );
    expect(removeEntityUsageResponse.status).toBe(StatusMap.OK);
    expect(
      ((await removeEntityUsageResponse.json()) as { temporalCoverage: string | null })
        .temporalCoverage,
    ).toBe('2025-03/..');

    const archivedEntityResponse = await app.handle(
      jsonRequest({ method: 'PUT', path: '/entities/luca-bianchi/archive' }),
    );
    expect(archivedEntityResponse.status).toBe(StatusMap['No Content']);
    expect(await archivedEntityResponse.text()).toBe('');

    const repeatedEntityArchiveResponse = await app.handle(
      jsonRequest({ method: 'PUT', path: '/entities/luca-bianchi/archive' }),
    );
    expect(repeatedEntityArchiveResponse.status).toBe(StatusMap['No Content']);

    const activeEntitiesResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/entities?query=luca-bianchi' }),
    );
    const activeEntities = (await activeEntitiesResponse.json()) as {
      items: Array<{ readableId: string }>;
      total: number;
    };
    expect(activeEntities.total).toBe(1);
    expect(activeEntities.items.map(({ readableId }) => readableId)).not.toContain('luca-bianchi');
    const archivedEntityDetailResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/entities/luca-bianchi' }),
    );
    expect(archivedEntityDetailResponse.status).toBe(StatusMap['Not Found']);

    const updateWithArchivedMentionResponse = await app.handle(
      jsonRequest({
        method: 'PUT',
        path: '/pages/growth-playbook',
        body: {
          expectedRevisionNumber: 3,
          markdown: `# Growth playbook

[Luca](context-use://entity/luca-bianchi) still owns the live account.`,
        },
      }),
    );
    expect(updateWithArchivedMentionResponse.status).toBe(StatusMap['Bad Request']);
    expect(await updateWithArchivedMentionResponse.json()).toEqual({
      error: 'Link target not found: entity/luca-bianchi',
    });

    const removePageUsageResponse = await app.handle(
      jsonRequest({
        method: 'PUT',
        path: '/pages/operating-rhythm',
        body: {
          expectedRevisionNumber: 1,
          temporalCoverage: null,
          markdown: '# Operating rhythm\n\nReview the feedback system every Friday.',
        },
      }),
    );
    expect(removePageUsageResponse.status).toBe(StatusMap.OK);
    const pageWithClearedCoverage = (await removePageUsageResponse.json()) as {
      temporalCoverage: string | null;
      revisions: Array<{ temporalCoverage: string | null }>;
    };
    expect(pageWithClearedCoverage.temporalCoverage).toBeNull();
    expect(
      pageWithClearedCoverage.revisions.map(({ temporalCoverage }) => temporalCoverage),
    ).toEqual([null, '2025~']);

    const pageBeforeArchive = await database<
      Array<{
        currentRevisionId: string;
        storageKey: string;
        outgoingMentions: number;
        outgoingReferences: number;
        revisions: number;
      }>
    >`
      select
        page."current_revision_id" as "currentRevisionId",
        revision."storage_key" as "storageKey",
        (select count(*) from "knowledge_page_entity_mention" mention
          where mention."source_revision_id" = page."current_revision_id") as "outgoingMentions",
        (select count(*) from "knowledge_page_reference" reference
          where reference."source_revision_id" = page."current_revision_id") as "outgoingReferences",
        (select count(*) from "knowledge_page_revision" history
          where history."page_id" = page."id") as "revisions"
      from "knowledge_page" page
      join "knowledge_page_revision" revision on revision."id" = page."current_revision_id"
      where page."owner_id" = ${OWNER_USER_ID} and page."readable_id" = 'growth-playbook'
    `;
    expect(Number(pageBeforeArchive[0]?.outgoingMentions)).toBe(1);
    expect(Number(pageBeforeArchive[0]?.outgoingReferences)).toBe(1);
    expect(Number(pageBeforeArchive[0]?.revisions)).toBe(EXPECTED_GROWTH_REVISION_COUNT);

    const archivedPageResponse = await app.handle(
      jsonRequest({ method: 'PUT', path: '/pages/growth-playbook/archive' }),
    );
    expect(archivedPageResponse.status).toBe(StatusMap['No Content']);
    expect(await archivedPageResponse.text()).toBe('');

    const activePagesResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/pages?query=growth-playbook' }),
    );
    const activePages = (await activePagesResponse.json()) as {
      items: Array<{ readableId: string }>;
      total: number;
    };
    expect(activePages.total).toBe(1);
    expect(activePages.items.map(({ readableId }) => readableId)).not.toContain('growth-playbook');

    const directlyAddressedArchivedPageResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/pages/growth-playbook' }),
    );
    expect(directlyAddressedArchivedPageResponse.status).toBe(StatusMap['Not Found']);

    const archivedPageState = await database<
      Array<{
        archivedAt: string | null;
        outgoingMentions: number;
        outgoingReferences: number;
        incomingReferences: number;
      }>
    >`
      select page."archived_at" as "archivedAt",
        (select count(*) from "knowledge_page_entity_mention" mention
          where mention."source_revision_id" = page."current_revision_id") as "outgoingMentions",
        (select count(*) from "knowledge_page_reference" outgoing
          where outgoing."source_revision_id" = page."current_revision_id") as "outgoingReferences",
        (select count(*) from "knowledge_page_reference" reference
          where reference."target_page_id" = page."id") as "incomingReferences"
      from "knowledge_page" page
      where page."owner_id" = ${OWNER_USER_ID} and page."readable_id" = 'growth-playbook'
    `;
    expect(archivedPageState[0]?.archivedAt).toBeString();
    expect(Number(archivedPageState[0]?.outgoingMentions)).toBe(0);
    expect(Number(archivedPageState[0]?.outgoingReferences)).toBe(0);
    expect(Number(archivedPageState[0]?.incomingReferences)).toBe(0);
    expect(await storage.exists(pageBeforeArchive[0]?.storageKey ?? '')).toBe(true);
    expect(await storage.file(pageBeforeArchive[0]?.storageKey ?? '').text()).toContain(
      '[Test Owner](context-use://entity/test-owner)',
    );

    const operatingPageResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/pages/operating-rhythm' }),
    );
    expect(((await operatingPageResponse.json()) as { references: unknown[] }).references).toEqual(
      [],
    );

    const updateWithArchivedPageReferenceResponse = await app.handle(
      jsonRequest({
        method: 'PUT',
        path: '/pages/operating-rhythm',
        body: {
          expectedRevisionNumber: 2,
          markdown:
            '# Operating rhythm\n\nUse the [feedback loop](context-use://page/growth-playbook) every Friday.',
        },
      }),
    );
    expect(updateWithArchivedPageReferenceResponse.status).toBe(StatusMap['Bad Request']);
    expect(await updateWithArchivedPageReferenceResponse.json()).toEqual({
      error: 'Link target not found: page/growth-playbook',
    });

    expect(
      await pagesRepository.find({ ownerId: 'someone-else', readableId: 'growth-playbook' }),
    ).toBeNull();

    const profileReadResponse = await app.handle(jsonRequest({ method: 'GET', path: '/profile' }));
    expect(profileReadResponse.status).toBe(StatusMap.OK);
    expectNoInternalResourceIds(await profileReadResponse.clone().json());
    expect(
      ((await profileReadResponse.json()) as { selfEntity: { readableId: string } }).selfEntity
        .readableId,
    ).toBe('test-owner');
  } finally {
    await database.close();
    await rm(dataFolder, { recursive: true, force: true });
  }
});
