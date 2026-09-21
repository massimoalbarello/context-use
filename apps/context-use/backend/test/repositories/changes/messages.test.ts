import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteDatabase } from '#backend/db/client.ts';
import { runMigrations } from '#backend/db/migrate.ts';
import { EntitiesRepository } from '#backend/repositories/entities/repository.ts';

test('resource changes persist their message and actor atomically, excluding no-ops', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'context-use-change-message-'));
  const database = await createSqliteDatabase({ dataFolder: folder });
  const now = '2026-09-21T12:00:00.000Z';
  try {
    await runMigrations({ db: database });
    await database`insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values ('owner', 'Rowan', 'owner@example.invalid', 1, ${now}, ${now})`;
    const entities = new EntitiesRepository(database);
    const original = {
      id: Bun.randomUUIDv7(),
      ownerId: 'owner',
      readableId: 'acme',
      name: 'Acme',
      description: 'A research organization',
      createdAt: now,
      change: { actor: { kind: 'owner' as const }, message: 'Added our research partner' },
    };
    await expect(
      entities.create({ ...original, change: { ...original.change, message: ' ' } }),
    ).rejects.toThrow();
    expect(await entities.find({ ownerId: 'owner', readableId: 'acme' })).toBeNull();
    expect(await database`select * from "resource_change"`).toEqual([]);
    await entities.create(original);
    await entities.update({ ...original, updatedAt: now });
    await entities.update({
      ...original,
      name: 'Acme Incorporated',
      updatedAt: now,
      change: {
        actor: { kind: 'mcp_client', name: 'Research assistant', clientAuthorizationId: 'client' },
        message: 'Corrected the registered company name',
      },
    });
    await entities.archive({
      ownerId: 'owner',
      readableId: 'acme',
      archivedAt: now,
      change: { ...original.change, message: 'Ended the research partnership' },
    });
    const changes =
      await database`select "owner_id", "name", "message", "author_kind", "author_name", "action" from "resource_change" order by "sequence"`;
    expect(changes).toEqual([
      {
        owner_id: 'owner',
        name: 'Acme',
        message: 'Added our research partner',
        author_kind: 'owner',
        author_name: 'Rowan',
        action: 'created',
      },
      {
        owner_id: 'owner',
        name: 'Acme Incorporated',
        message: 'Corrected the registered company name',
        author_kind: 'mcp_client',
        author_name: 'Research assistant',
        action: 'updated',
      },
      {
        owner_id: 'owner',
        name: 'Acme Incorporated',
        message: 'Ended the research partnership',
        author_kind: 'owner',
        author_name: 'Rowan',
        action: 'archived',
      },
    ]);
  } finally {
    await database.close();
    await rm(folder, { recursive: true, force: true });
  }
});
