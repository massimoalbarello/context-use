import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteDatabase } from '#db/client.ts';
import { runMigrations } from '#db/migrate.ts';
import { LocalStorage } from '#lib/storage/local-storage.ts';
import { temporalBoundsFrom } from '#models/knowledge-pages/temporal-coverage.ts';
import { EntitiesRepository } from '#repositories/entities/repository.ts';
import { HypermediaRepository } from '#repositories/hypermedia/repository.ts';
import { KnowledgePagesRepository } from '#repositories/knowledge-pages/repository.ts';
import { KnowledgePagesService } from '#services/knowledge-pages/service.ts';

const OWNER_A = 'owner-a';
const NOW = '2026-09-08T12:00:00.000Z';

test.each([
  { time: undefined, expectedPages: ['undated'] },
  { time: '1968', expectedPages: [] },
  { time: '1969-12', expectedPages: ['before-epoch', 'ongoing'] },
  { time: '1970-01', expectedPages: ['at-epoch', 'ongoing'] },
  { time: '1970-02', expectedPages: ['after-epoch', 'ongoing'] },
  { time: '1970/..', expectedPages: ['after-epoch', 'at-epoch', 'ongoing'] },
])('map browsing applies time before pagination: %j', async ({ time, expectedPages }) => {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-hypermedia-test-'));
  const database = await createSqliteDatabase({ dataFolder });
  try {
    await runMigrations({ db: database });
    await database`insert into auth_user (id, name, email, emailVerified, createdAt, updatedAt)
      values (${OWNER_A}, 'Owner', 'owner@example.com', 1, ${NOW}, ${NOW})`;
    const entities = new EntitiesRepository(database);
    const pages = new KnowledgePagesService({
      pages: new KnowledgePagesRepository(database),
      storage: new LocalStorage(join(dataFolder, 'objects')),
    });
    await entities.create({
      id: 'topic-id',
      ownerId: OWNER_A,
      createdAt: NOW,
      readableId: 'topic',
      name: 'Topic',
      description: 'Needle research.',
    });
    for (const [title, temporalCoverage] of [
      ['Undated', undefined],
      ['Before epoch', '1969-12'],
      ['At epoch', '1970-01'],
      ['After epoch', '1970-02'],
      ['Ongoing', '1969-12/..'],
    ] as const) {
      const result = await pages.create({
        ownerId: OWNER_A,
        actor: { kind: 'owner' },
        markdown: `# ${title}\n\nNeedle research involving [Topic](context-use://entity/topic).`,
        temporalCoverage,
      });
      expect(result.state).toBe('saved');
    }
    const hypermedia = new HypermediaRepository(database);
    const input = {
      ownerId: OWNER_A,
      entities: [{ readableId: 'topic' }],
      visibleEntities: [],
      limit: 1,
      temporalBounds: time ? temporalBoundsFrom(time) : undefined,
    };
    const readableIds: string[] = [];
    for (let offset = 0; offset <= expectedPages.length; offset += 1) {
      const result = await hypermedia.pages({ ...input, offset });
      readableIds.push(...result.pages.map((page) => page.readableId));
      expect(result.nextOffset).toBe(offset + 1 < expectedPages.length ? offset + 1 : null);
    }
    expect(readableIds.sort()).toEqual([...expectedPages]);
  } finally {
    await database.close();
    await rm(dataFolder, { recursive: true, force: true });
  }
});
