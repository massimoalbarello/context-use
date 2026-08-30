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
import { EntitiesRepository } from '#repositories/entities.repository.ts';
import { HealthRepository } from '#repositories/health.repository.ts';
import { KnowledgePagesRepository } from '#repositories/knowledge-pages.repository.ts';
import { KnowledgeProfilesRepository } from '#repositories/knowledge-profiles.repository.ts';
import { OwnerRegistrationRepository } from '#repositories/owner-registration.repository.ts';
import type { AssetsServiceContract } from '#services/assets.service.ts';
import { EntitiesService } from '#services/entities.service.ts';
import { HealthService } from '#services/health.service.ts';
import { KnowledgePagesService } from '#services/knowledge-pages.service.ts';
import { KnowledgeProfilesService } from '#services/knowledge-profiles.service.ts';
import { OwnerRegistrationService } from '#services/owner-registration.service.ts';

const AUTH_MIGRATION = new URL(
  '../../../src/db/migrations/0000_better_auth_schema.sql',
  import.meta.url,
);
const KNOWLEDGE_MIGRATION = new URL(
  '../../../src/db/migrations/0001_knowledge.sql',
  import.meta.url,
);
const EXPECTED_ENTITY_COUNT = 3;

const assetsService: AssetsServiceContract = {
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
    const pagesService = new KnowledgePagesService({
      pages: pagesRepository,
      storage: new LocalStorage(join(dataFolder, 'objects')),
    });
    const app = createApp({
      auth: ownerAuth(),
      assetsService,
      entitiesService: new EntitiesService({
        entities: new EntitiesRepository(database),
        pages: pagesRepository,
      }),
      healthService: new HealthService(new HealthRepository(database)),
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

    const unreadableNameResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/entities',
        body: {
          name: '東京',
          description: 'A place whose name needs an explicitly chosen readable address.',
        },
      }),
    );
    expect(unreadableNameResponse.status).toBe(StatusMap['Bad Request']);
    expect(await unreadableNameResponse.json()).toEqual({
      error: 'A readable ID could not be derived from this name',
      readableIdRequired: true,
    });

    const entityResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/entities',
        body: {
          name: 'Luca Bianchi',
          description: 'The product lead responsible for the growth system.',
        },
      }),
    );
    expect(entityResponse.status).toBe(StatusMap.Created);
    const entity = (await entityResponse.json()) as { id: string };
    expect(entity.id[14]).toBe('7');

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
      error: 'An entity already uses this readable ID',
      readableId: 'luca-bianchi',
    });

    const distinguishedEntityResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/entities',
        body: {
          readableId: 'research-luca-bianchi',
          name: 'Luca Bianchi',
          description: 'A different person with the same name and a distinct role.',
        },
      }),
    );
    expect(distinguishedEntityResponse.status).toBe(StatusMap.Created);

    const firstEntityPageResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/entities?limit=2&offset=0' }),
    );
    expect(firstEntityPageResponse.status).toBe(StatusMap.OK);
    const firstEntityPage = (await firstEntityPageResponse.json()) as {
      items: Array<{ id: string }>;
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
      items: Array<{ id: string }>;
      total: number;
      nextOffset: number | null;
    };
    expect(secondEntityPage.items).toHaveLength(1);
    expect(secondEntityPage.total).toBe(EXPECTED_ENTITY_COUNT);
    expect(secondEntityPage.nextOffset).toBeNull();
    expect(secondEntityPage.items[0]?.id).not.toBe(firstEntityPage.items[0]?.id);
    expect(secondEntityPage.items[0]?.id).not.toBe(firstEntityPage.items[1]?.id);

    const searchedEntityPageResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/entities?limit=7&offset=0&query=research' }),
    );
    expect(await searchedEntityPageResponse.json()).toEqual({
      items: [expect.objectContaining({ readableId: 'research-luca-bianchi' })],
      total: 1,
      nextOffset: null,
    });

    const growthResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/pages',
        body: {
          markdown: `# Growth playbook

[Luca](context-use://entity/luca-bianchi) owns this feedback system.

## Feedback loop

Every observation changes the next action.`,
        },
      }),
    );
    expect(growthResponse.status).toBe(StatusMap.Created);
    const growth = (await growthResponse.json()) as {
      id: string;
      revisionNumber: number;
      mentions: Array<{ readableId: string }>;
    };
    expect(growth.id[14]).toBe('7');
    expect(growth.revisionNumber).toBe(1);
    expect(growth.mentions.map(({ readableId }) => readableId)).toEqual(['luca-bianchi']);

    const pageConflictResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/pages',
        body: { markdown: '# Growth playbook\n\nA different page with the same title.' },
      }),
    );
    expect(pageConflictResponse.status).toBe(StatusMap.Conflict);
    expect(await pageConflictResponse.json()).toEqual({
      error: 'A page already uses this readable ID',
      readableId: 'growth-playbook',
    });

    const rhythmResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/pages',
        body: {
          markdown: `# Operating rhythm

Use the [feedback loop](context-use://page/growth-playbook#feedback-loop) every Friday.`,
        },
      }),
    );
    expect(rhythmResponse.status).toBe(StatusMap.Created);

    const firstKnowledgePageResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/pages?limit=1&offset=0' }),
    );
    const firstKnowledgePage = (await firstKnowledgePageResponse.json()) as {
      items: Array<{ id: string; readableId: string }>;
      total: number;
      nextOffset: number | null;
    };
    expect(firstKnowledgePage.items).toHaveLength(1);
    expect(firstKnowledgePage.total).toBe(2);
    expect(firstKnowledgePage.nextOffset).toBe(1);

    const secondKnowledgePageResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/pages?limit=1&offset=1' }),
    );
    const secondKnowledgePage = (await secondKnowledgePageResponse.json()) as {
      items: Array<{ id: string; readableId: string }>;
      total: number;
      nextOffset: number | null;
    };
    expect(secondKnowledgePage.items).toHaveLength(1);
    expect(secondKnowledgePage.total).toBe(2);
    expect(secondKnowledgePage.nextOffset).toBeNull();
    expect(
      [firstKnowledgePage.items[0]?.readableId, secondKnowledgePage.items[0]?.readableId].sort(),
    ).toEqual(['growth-playbook', 'operating-rhythm']);

    const searchedKnowledgePageResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/pages?limit=7&offset=0&query=growth' }),
    );
    expect(await searchedKnowledgePageResponse.json()).toEqual({
      items: [expect.objectContaining({ readableId: 'growth-playbook' })],
      total: 1,
      nextOffset: null,
    });

    const linkedGrowthResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/pages/growth-playbook' }),
    );
    const linkedGrowth = (await linkedGrowthResponse.json()) as {
      backlinks: Array<{ page: { readableId: string }; fragment: string | null }>;
    };
    expect(linkedGrowth.backlinks).toEqual([
      {
        page: expect.objectContaining({ readableId: 'operating-rhythm' }),
        fragment: 'feedback-loop',
      },
    ]);

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
      revisionNumber: number;
      revisions: Array<{ revisionNumber: number; title: string }>;
    };
    expect(updatedPage.revisionNumber).toBe(2);
    expect(updatedPage.revisions).toEqual([
      expect.objectContaining({ revisionNumber: 2, title: 'Growth playbook' }),
      expect.objectContaining({ revisionNumber: 1, title: 'Growth playbook' }),
    ]);
    const currentMentionCount = await database<Array<{ count: number }>>`
      select count(*) as "count" from "knowledge_page_entity_mention"
    `;
    expect(Number(currentMentionCount[0]?.count)).toBe(1);

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
    await pagesService.rebuildIndex({ ownerId: OWNER_USER_ID });

    const rebuiltResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/pages/growth-playbook' }),
    );
    const rebuilt = (await rebuiltResponse.json()) as {
      mentions: Array<{ readableId: string }>;
      backlinks: Array<{ page: { readableId: string } }>;
    };
    expect(rebuilt.mentions.map(({ readableId }) => readableId)).toEqual(['luca-bianchi']);
    expect(rebuilt.backlinks.map(({ page }) => page.readableId)).toEqual(['operating-rhythm']);

    const entityDetailResponse = await app.handle(
      jsonRequest({ method: 'GET', path: '/entities/luca-bianchi' }),
    );
    expect(entityDetailResponse.status).toBe(StatusMap.OK);
    expect(
      ((await entityDetailResponse.json()) as { pages: Array<{ readableId: string }> }).pages.map(
        ({ readableId }) => readableId,
      ),
    ).toEqual(['growth-playbook']);

    expect(
      await pagesRepository.find({ ownerId: 'someone-else', readableId: 'growth-playbook' }),
    ).toBeNull();

    const profileReadResponse = await app.handle(jsonRequest({ method: 'GET', path: '/profile' }));
    expect(profileReadResponse.status).toBe(StatusMap.OK);
    expect(
      ((await profileReadResponse.json()) as { selfEntity: { readableId: string } }).selfEntity
        .readableId,
    ).toBe('test-owner');
  } finally {
    await database.close();
    await rm(dataFolder, { recursive: true, force: true });
  }
});
