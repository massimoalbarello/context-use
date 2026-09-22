import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteDatabase } from '#backend/db/client.ts';
import { runMigrations } from '#backend/db/migrate.ts';
import { EntitiesRepository } from '#backend/repositories/entities/repository.ts';

test('resource changes persist their message and client name atomically, excluding no-ops', async () => {
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
      change: { clientName: null, message: 'Added our research partner' },
    };
    await expect(
      entities.create({ ...original, change: { ...original.change, message: ' ' } }),
    ).rejects.toThrow();
    expect(await entities.find({ ownerId: 'owner', readableId: 'acme' })).toBeNull();
    expect(await database`select * from "resource_change"`).toHaveLength(0);
    await entities.create(original);
    await entities.update({ ...original, updatedAt: now });
    await entities.update({
      ...original,
      name: 'Acme Incorporated',
      updatedAt: now,
      change: {
        clientName: 'Research assistant',
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
      await database`select "owner_id", "name", "message", "client_name", "action" from "resource_change" order by "sequence"`;
    expect(changes).toEqual([
      {
        owner_id: 'owner',
        name: 'Acme',
        message: 'Added our research partner',
        client_name: null,
        action: 'created',
      },
      {
        owner_id: 'owner',
        name: 'Acme Incorporated',
        message: 'Corrected the registered company name',
        client_name: 'Research assistant',
        action: 'updated',
      },
      {
        owner_id: 'owner',
        name: 'Acme Incorporated',
        message: 'Ended the research partnership',
        client_name: null,
        action: 'archived',
      },
    ]);
  } finally {
    await database.close();
    await rm(folder, { recursive: true, force: true });
  }
});
