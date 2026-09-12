import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteDatabase } from '#db/client.ts';
import { runMigrations } from '#db/migrate.ts';
import { LocalStorage } from '#lib/storage/local-storage.ts';
import type { HypermediaPage } from '#models/hypermedia/model.ts';
import { temporalBoundsFrom } from '#models/knowledge-pages/temporal-coverage.ts';
import { AssetsRepository } from '#repositories/assets/repository.ts';
import { EntitiesRepository } from '#repositories/entities/repository.ts';
import { HypermediaRepository } from '#repositories/hypermedia/repository.ts';
import { KnowledgePagesRepository } from '#repositories/knowledge-pages/repository.ts';
import { KnowledgePagesService } from '#services/knowledge-pages/service.ts';

const NOW = '2026-09-01T00:00:00.000Z';
const OWNER = 'owner-a';
const OTHER_OWNER = 'owner-b';

async function graphFixture() {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-graph-test-'));
  const database = await createSqliteDatabase({ dataFolder });
  const dispose = async () => {
    await database.close();
    await rm(dataFolder, { recursive: true, force: true });
  };
  try {
    await runMigrations({ db: database });
    for (const ownerId of [OWNER, OTHER_OWNER]) {
      await database`
        insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
        values (${ownerId}, ${ownerId}, ${`${ownerId}@example.com`}, 1, ${NOW}, ${NOW})
      `;
    }
    const entities = new EntitiesRepository(database);
    const pages = new KnowledgePagesService({
      pages: new KnowledgePagesRepository(database),
      storage: new LocalStorage(join(dataFolder, 'objects')),
    });
    return {
      dispose,
      graph: new HypermediaRepository(database),
      assets: new AssetsRepository(database),
      entities,
      pages,
      async entity({ readableId, ownerId = OWNER }: { readableId: string; ownerId?: string }) {
        expect(
          await entities.create({
            id: Bun.randomUUIDv7(),
            ownerId,
            readableId,
            name: readableId,
            description: 'An entity fixture.',
            createdAt: NOW,
          }),
        ).toMatchObject({ state: 'created' });
      },
      async page({
        title,
        body = 'A page without entity mentions.',
        time,
        ownerId = OWNER,
      }: {
        title: string;
        body?: string;
        time?: string;
        ownerId?: string;
      }) {
        expect(
          await pages.create({
            ownerId,
            actor: { kind: 'owner' },
            markdown: `# ${title}\n\n${body}`,
            temporalCoverage: time,
          }),
        ).toMatchObject({ state: 'saved' });
      },
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

function mention(readableId: string): string {
  return `[${readableId}](context-use://entity/${readableId})`;
}

test('page enumeration includes disconnected and asset-only pages before interval pagination', async () => {
  const fixture = await graphFixture();
  try {
    await fixture.entity({ readableId: 'anchor' });
    await fixture.entity({ readableId: 'disconnected' });
    await fixture.assets.create({
      id: Bun.randomUUIDv7(),
      ownerId: OWNER,
      readableId: 'chart',
      name: 'Chart',
      mediaType: 'text/plain',
      extension: 'txt',
      sizeBytes: 1,
      storageKey: `${OWNER}/chart`,
      contentHash: new Bun.CryptoHasher('sha256').update('x').digest('hex'),
      createdAt: NOW,
      updatedAt: NOW,
    });
    await fixture.page({ title: 'Unlinked', time: '2026-09' });
    await fixture.page({
      title: 'Asset only',
      time: '2026-09',
      body: '[Chart](context-use://asset/chart)',
    });
    await fixture.page({
      title: 'Disconnected page',
      time: '2026-09',
      body: mention('disconnected'),
    });
    await fixture.page({ title: 'Anchor page', time: '2026-09', body: mention('anchor') });
    await fixture.page({ title: 'Undated' });
    await fixture.page({ title: 'Outside interval', time: '2026-10' });
    await fixture.page({ title: 'Archived', time: '2026-09' });
    await fixture.pages.archive({ ownerId: OWNER, readableId: 'archived' });
    await fixture.page({ title: 'Other owner', time: '2026-09', ownerId: OTHER_OWNER });
    const input = {
      ownerId: OWNER,
      resources: [],
      limit: 1,
      temporalBounds: temporalBoundsFrom('2026-09'),
    };
    const pages: HypermediaPage[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const batch = await fixture.graph.pages({ ...input, offset });
      pages.push(...batch.pages);
      expect(batch.resourceReferencesTruncated).toBe(false);
      if (batch.nextOffset !== null) {
        expect(batch.nextOffset).toBe(offset + 1);
      }
      offset = batch.nextOffset;
    }
    expect(pages.map(({ readableId }) => readableId).sort()).toEqual([
      'anchor-page',
      'asset-only',
      'disconnected-page',
      'unlinked',
    ]);
    expect(pages.find(({ readableId }) => readableId === 'asset-only')?.resources).toEqual([]);
    expect(pages.find(({ readableId }) => readableId === 'unlinked')?.resources).toEqual([]);
    expect(
      await fixture.graph.pages({ ...input, offset: 0, temporalBounds: undefined }),
    ).toMatchObject({
      pages: [{ readableId: 'undated', resources: [] }],
      nextOffset: null,
    });
    expect(
      await fixture.graph.pages({
        ...input,
        offset: 0,
        resources: [{ kind: 'entity', readableId: 'anchor' }],
      }),
    ).toMatchObject({
      pages: [{ readableId: 'anchor-page' }],
      nextOffset: null,
    });
    expect(
      await fixture.graph.resourceNeighborhood({
        ownerId: OWNER,
        anchor: { kind: 'entity', readableId: 'disconnected' },
        limit: 1,
      }),
    ).toMatchObject({
      anchor: { entity: { readableId: 'disconnected' } },
      neighbors: [],
      nextPage: null,
    });
  } finally {
    await fixture.dispose();
  }
});

test('entity neighborhoods rank distinct current shared pages with stable continuation and owner isolation', async () => {
  const fixture = await graphFixture();
  try {
    for (const ownerId of [OWNER, OTHER_OWNER]) {
      for (const readableId of ['anchor', 'alpha', 'beta']) {
        await fixture.entity({ readableId, ownerId });
      }
    }
    await fixture.entity({ readableId: 'private', ownerId: OTHER_OWNER });
    await fixture.page({
      title: 'First',
      body: `${mention('anchor')} ${mention('alpha')} ${mention('alpha')} ${mention('beta')}`,
    });
    await fixture.page({ title: 'Second', body: `${mention('anchor')} ${mention('beta')}` });
    await fixture.page({
      title: 'Private',
      body: `${mention('anchor')} ${mention('alpha')} ${mention('private')}`,
      ownerId: OTHER_OWNER,
    });
    const input = {
      ownerId: OWNER,
      anchor: { kind: 'entity' as const, readableId: 'anchor' },
      limit: 1,
    };
    const first = await fixture.graph.resourceNeighborhood(input);
    expect(first).toMatchObject({
      neighbors: [
        { resource: { kind: 'entity', entity: { readableId: 'beta' } }, sharedPageCount: 2 },
      ],
      nextPage: { sharedPageCount: 2, readableId: 'beta' },
    });
    expect(
      await fixture.graph.resourceNeighborhood({ ...input, cursor: first!.nextPage! }),
    ).toMatchObject({
      neighbors: [{ resource: { entity: { readableId: 'alpha' } }, sharedPageCount: 1 }],
      nextPage: null,
    });
    expect(
      await fixture.pages.update({
        ownerId: OWNER,
        actor: { kind: 'owner' },
        readableId: 'second',
        expectedRevisionNumber: 1,
        markdown: `# Second\n\n${mention('anchor')}`,
      }),
    ).toMatchObject({ state: 'saved' });
    const tied = await fixture.graph.resourceNeighborhood(input);
    expect(tied).toMatchObject({
      neighbors: [{ resource: { entity: { readableId: 'alpha' } }, sharedPageCount: 1 }],
    });
    expect(
      await fixture.graph.resourceNeighborhood({ ...input, cursor: tied!.nextPage! }),
    ).toMatchObject({
      neighbors: [{ resource: { entity: { readableId: 'beta' } }, sharedPageCount: 1 }],
      nextPage: null,
    });
    await fixture.pages.archive({ ownerId: OWNER, readableId: 'first' });
    expect(await fixture.graph.resourceNeighborhood(input)).toMatchObject({
      neighbors: [],
      nextPage: null,
    });
    expect(
      await fixture.graph.resourceNeighborhood({
        ...input,
        anchor: { kind: 'entity', readableId: 'private' },
      }),
    ).toBeNull();
    await fixture.entities.archive({ ownerId: OWNER, readableId: 'alpha', archivedAt: NOW });
    expect(
      await fixture.graph.resourceNeighborhood({
        ...input,
        anchor: { kind: 'entity', readableId: 'alpha' },
      }),
    ).toBeNull();
  } finally {
    await fixture.dispose();
  }
});
