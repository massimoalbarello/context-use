import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteDatabase } from '#db/client.ts';
import { runMigrations } from '#db/migrate.ts';
import { LocalStorage } from '#lib/storage/local-storage.ts';
import { MAX_HYPERMEDIA_EXTRA_RELATIONSHIPS } from '#models/hypermedia-graph/model.ts';
import { EntitiesRepository } from '#repositories/entities/repository.ts';
import { HypermediaGraphRepository } from '#repositories/hypermedia-graph/repository.ts';
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
      graph: new HypermediaGraphRepository(database),
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

function anchor(readableId: string) {
  return { anchor: { readableId } };
}

test('multi-anchor neighborhoods have independent ranks and cursors, deduplicated entities and induced edges', async () => {
  const fixture = await graphFixture();
  try {
    for (const readableId of ['anchor', 'alpha', 'beta', 'delta', 'orphan']) {
      await fixture.entity({ readableId });
    }
    for (const readableId of ['anchor', 'alpha', 'private']) {
      await fixture.entity({ readableId, ownerId: OTHER_OWNER });
    }
    await fixture.page({
      title: 'First',
      body: [mention('anchor'), mention('alpha'), mention('alpha'), mention('beta')].join(' '),
    });
    await fixture.page({ title: 'Second', body: [mention('anchor'), mention('beta')].join(' ') });
    await fixture.page({
      title: 'Other component',
      body: [mention('delta'), mention('alpha')].join(' '),
    });
    await fixture.page({
      title: 'Private',
      body: [mention('anchor'), mention('alpha'), mention('private')].join(' '),
      ownerId: OTHER_OWNER,
    });
    const input = {
      ownerId: OWNER,
      anchors: [anchor('anchor'), anchor('delta'), anchor('orphan'), anchor('private')],
      limit: 1,
    };
    const first = await fixture.graph.neighborhoods(input);
    expect(first.neighborhoods).toEqual([
      {
        anchor: anchor('anchor').anchor,
        available: true,
        neighbors: [{ entity: anchor('beta').anchor, sharedPageCount: 2 }],
        nextPage: { sharedPageCount: 2, readableId: 'beta' },
      },
      {
        anchor: anchor('delta').anchor,
        available: true,
        neighbors: [{ entity: anchor('alpha').anchor, sharedPageCount: 1 }],
        nextPage: null,
      },
      { anchor: anchor('orphan').anchor, available: true, neighbors: [], nextPage: null },
      { anchor: anchor('private').anchor, available: false, neighbors: [], nextPage: null },
    ]);
    expect(first.entities.map((entity) => entity.readableId).sort()).toEqual([
      'alpha',
      'anchor',
      'beta',
      'delta',
      'orphan',
    ]);
    expect(first.relationships).toContainEqual({
      source: anchor('alpha').anchor,
      target: anchor('beta').anchor,
      sharedPageCount: 1,
    });
    expect(first.relationshipsTruncated).toBe(false);
    expect(
      new Set(
        first.relationships.map(
          ({ source, target }) => `${source.readableId}:${target.readableId}`,
        ),
      ).size,
    ).toBe(first.relationships.length);
    const next = await fixture.graph.neighborhoods({
      ...input,
      anchors: [
        { ...anchor('anchor'), cursor: first.neighborhoods[0]!.nextPage! },
        anchor('delta'),
      ],
    });
    expect(next.neighborhoods[0]).toMatchObject({
      neighbors: [{ entity: anchor('alpha').anchor, sharedPageCount: 1 }],
      nextPage: null,
    });
    expect(next.neighborhoods[1]).toEqual(first.neighborhoods[1]!);
    expect(next.entities.filter((entity) => entity.readableId === 'alpha')).toHaveLength(1);
    expect(next.entities.some((entity) => entity.readableId === 'beta')).toBe(false);
    expect(
      next.relationships.some(
        ({ source, target }) => source.readableId === 'beta' || target.readableId === 'beta',
      ),
    ).toBe(false);

    await fixture.pages.update({
      ownerId: OWNER,
      actor: { kind: 'owner' },
      readableId: 'second',
      expectedRevisionNumber: 1,
      markdown: `# Second\n\n${mention('anchor')}`,
    });
    const tied = await fixture.graph.neighborhoods(input);
    expect(tied.neighborhoods[0]).toMatchObject({
      neighbors: [{ entity: anchor('alpha').anchor, sharedPageCount: 1 }],
      nextPage: { sharedPageCount: 1, readableId: 'alpha' },
    });
    const tieNext = await fixture.graph.neighborhoods({
      ...input,
      anchors: [{ ...anchor('anchor'), cursor: tied.neighborhoods[0]!.nextPage! }],
    });
    expect(tieNext.neighborhoods[0]).toMatchObject({
      neighbors: [{ entity: anchor('beta').anchor, sharedPageCount: 1 }],
      nextPage: null,
    });
    await fixture.pages.archive({ ownerId: OWNER, readableId: 'first' });
    await fixture.pages.archive({ ownerId: OWNER, readableId: 'other-component' });
    await fixture.entities.archive({ ownerId: OWNER, readableId: 'alpha', archivedAt: NOW });
    const archived = await fixture.graph.neighborhoods({
      ...input,
      anchors: [anchor('anchor'), anchor('alpha')],
    });
    expect(archived.relationships).toEqual([]);
    expect(archived.neighborhoods).toMatchObject([
      { available: true, neighbors: [], nextPage: null },
      { available: false, neighbors: [], nextPage: null },
    ]);
  } finally {
    await fixture.dispose();
  }
});

test('extra relationships are bounded without dropping requested neighbor edges or inventing entities', async () => {
  const fixture = await graphFixture();
  try {
    const neighborsPerAnchor = 24;
    const left = [...Array(neighborsPerAnchor).keys()].map((index) => `left-${index}`);
    const right = [...Array(neighborsPerAnchor).keys()].map((index) => `right-${index}`);
    for (const readableId of ['a', 'b', ...left, ...right]) {
      await fixture.entity({ readableId });
    }
    await fixture.page({ title: 'Left', body: ['a', ...left].map(mention).join(' ') });
    await fixture.page({ title: 'Right', body: ['b', ...right].map(mention).join(' ') });
    await fixture.page({
      title: 'Neighbors only',
      body: [...left, ...right].map(mention).join(' '),
    });
    const graph = await fixture.graph.neighborhoods({
      ownerId: OWNER,
      anchors: [anchor('a'), anchor('b')],
      limit: neighborsPerAnchor,
    });
    expect(graph.entities).toHaveLength(neighborsPerAnchor * 2 + 2);
    expect(graph.relationshipsTruncated).toBe(true);
    const requestedEdgeCount = neighborsPerAnchor * 2;
    expect(graph.relationships).toHaveLength(
      MAX_HYPERMEDIA_EXTRA_RELATIONSHIPS + requestedEdgeCount,
    );
    for (const neighborhood of graph.neighborhoods) {
      expect(neighborhood.nextPage).toBeNull();
      expect(neighborhood.neighbors).toHaveLength(neighborsPerAnchor);
      for (const neighbor of neighborhood.neighbors) {
        expect(graph.relationships).toContainEqual({
          source: neighborhood.anchor,
          target: neighbor.entity,
          sharedPageCount: 1,
        });
      }
    }
  } finally {
    await fixture.dispose();
  }
});
