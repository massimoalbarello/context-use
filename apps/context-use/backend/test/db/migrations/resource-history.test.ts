import { expect, test } from 'bun:test';
import { runMigrations } from '#backend/db/migrate.ts';
import { getMigrations } from '#backend/lib/assets.ts';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { EntitiesRepository } from '#backend/repositories/entities/repository.ts';
import { withAuthTestDatabase } from '../../lib/auth/auth-test-database.ts';

const HISTORY_MIGRATION_NAME = '0016_reset_resource_history_for_unarchiving.sql';

test('resetting history discards all old events, preserves resources, and runs only once', async () => {
  await withAuthTestDatabase({
    migrations: new Map([...getMigrations()].filter(([name]) => name < HISTORY_MIGRATION_NAME)),
    run: async (database) => {
      const now = new Date().toISOString();
      const entities = new EntitiesRepository(database);
      for (const ownerId of [OWNER_USER_ID, 'other-owner']) {
        await database`
          insert into "auth_user"
            ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
          values (${ownerId}, ${'Owner'}, ${`${ownerId}@example.invalid`}, ${true}, ${now}, ${now})
        `;
        await entities.create({
          id: Bun.randomUUIDv7(),
          ownerId,
          readableId: 'colleague',
          name: 'Colleague',
          description: 'Preserved resource',
          createdAt: now,
          change: { clientName: null, message: 'Added a colleague' },
        });
      }
      const ownersBefore = await database`select * from "auth_user" order by "id"`;
      const entitiesBefore = await database`select * from "entity" order by "owner_id"`;
      const historyBefore = await database`select * from "resource_change" order by "sequence"`;
      expect(historyBefore).toHaveLength(ownersBefore.length);

      const migration = getMigrations().get(HISTORY_MIGRATION_NAME);
      if (!migration) {
        throw new Error('Missing history reset migration');
      }
      await expect(
        runMigrations({
          db: database,
          migrations: new Map([
            [
              HISTORY_MIGRATION_NAME,
              new Blob([await migration.text(), '\ncreate table "resource_change" ("id" text);']),
            ],
          ]),
        }),
      ).rejects.toThrow('already exists');
      expect(await database`select * from "resource_change" order by "sequence"`).toEqual(
        historyBefore,
      );

      await runMigrations({ db: database });

      expect(await database`select * from "resource_change"`).toHaveLength(0);
      expect(await database`select * from "auth_user" order by "id"`).toEqual(ownersBefore);
      expect(await database`select * from "entity" order by "owner_id"`).toEqual(entitiesBefore);
      const insertAction = async ({
        action,
        ownerId = OWNER_USER_ID,
      }: {
        action: string;
        ownerId?: string;
      }) => database`
        insert into "resource_change"
          ("owner_id", "resource_type", "readable_id", "name", "action", "message", "details", "created_at")
        values (${ownerId}, ${'entity'}, ${'colleague'}, ${'Colleague'}, ${action},
          ${'Restored a colleague'}, ${'[]'}, ${now})
        returning "sequence"
      `;
      expect(await insertAction({ action: 'unarchived' })).toEqual([{ sequence: 1 }]);
      await expect(insertAction({ action: 'unknown' })).rejects.toThrow();
      await expect(
        insertAction({ action: 'unarchived', ownerId: 'missing-owner' }),
      ).rejects.toThrow();
      const newHistory = await database`select * from "resource_change"`;
      await runMigrations({ db: database });
      expect(await database`select * from "resource_change"`).toEqual(newHistory);
      expect(await database.unsafe('pragma foreign_key_check')).toHaveLength(0);
      expect(
        (await database.unsafe('pragma index_info("resource_change_owner_order")')).map(
          (column: { name: string }) => column.name,
        ),
      ).toEqual(['owner_id', 'created_at', 'sequence']);
    },
  });
});
