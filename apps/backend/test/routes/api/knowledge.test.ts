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
import type { AssetsServiceContract } from '#services/assets.service.ts';
import { EntitiesService } from '#services/entities.service.ts';
import { HealthService } from '#services/health.service.ts';
import { KnowledgePagesService } from '#services/knowledge-pages.service.ts';

const AUTH_MIGRATION = new URL(
  '../../../src/db/migrations/0000_better_auth_schema.sql',
  import.meta.url,
);
const KNOWLEDGE_MIGRATION = new URL(
  '../../../src/db/migrations/0001_knowledge.sql',
  import.meta.url,
);

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
      pagesService,
    });

    const entityResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/entities',
        body: {
          readableId: 'luca-bianchi',
          name: 'Luca Bianchi',
          description: 'The product lead responsible for the growth system.',
        },
      }),
    );
    expect(entityResponse.status).toBe(StatusMap.Created);
    const entity = (await entityResponse.json()) as { id: string };
    expect(entity.id[14]).toBe('7');

    const growthResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/pages',
        body: {
          readableId: 'growth-playbook',
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

    const rhythmResponse = await app.handle(
      jsonRequest({
        method: 'POST',
        path: '/pages',
        body: {
          readableId: 'operating-rhythm',
          markdown: `# Operating rhythm

Use the [feedback loop](context-use://page/growth-playbook#feedback-loop) every Friday.`,
        },
      }),
    );
    expect(rhythmResponse.status).toBe(StatusMap.Created);

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
    expect(((await updateResponse.json()) as { revisionNumber: number }).revisionNumber).toBe(2);
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
  } finally {
    await database.close();
    await rm(dataFolder, { recursive: true, force: true });
  }
});
