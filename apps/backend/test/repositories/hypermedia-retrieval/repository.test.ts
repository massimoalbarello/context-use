import { expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SQL } from 'bun';
import { createSqliteDatabase, createSqliteReader } from '#db/client.ts';
import { runMigrations } from '#db/migrate.ts';
import { LocalStorage } from '#lib/storage/local-storage.ts';
import type { EntityType } from '#models/entities/model.ts';
import {
  MAX_HYPERMEDIA_MATCH_EXCERPT_LENGTH,
  MAX_HYPERMEDIA_SEARCH_LIMIT,
} from '#models/hypermedia-retrieval/model.ts';
import { temporalBoundsFrom } from '#models/knowledge-pages/temporal-coverage.ts';
import type {
  DeliveredRecord,
  RecordContent,
} from '#models/records/delivery-contract.generated.ts';
import { AssetsRepository } from '#repositories/assets/repository.ts';
import { EntitiesRepository } from '#repositories/entities/repository.ts';
import { HypermediaRepository } from '#repositories/hypermedia/repository.ts';
import { HypermediaRetrievalRepository } from '#repositories/hypermedia-retrieval/repository.ts';
import { KnowledgePagesRepository } from '#repositories/knowledge-pages/repository.ts';
import { KnowledgeProfilesRepository } from '#repositories/knowledge-profiles/repository.ts';
import { RecordsRepository } from '#repositories/records/repository.ts';
import { replaceSearchDocument } from '#repositories/search-index.ts';
import { HypermediaRetrievalService } from '#services/hypermedia-retrieval/service.ts';
import { KnowledgePagesService } from '#services/knowledge-pages/service.ts';
import { RecordsService } from '#services/records/service.ts';

const OWNER_A = 'owner-a';
const OWNER_B = 'owner-b';
const NOW = '2026-09-08T12:00:00.000Z';
const SHA256_HEX_LENGTH = 64;
const SIGNAL_ASSET_COUNT = 3;

async function createRecordSync({
  database,
  ownerId = OWNER_A,
}: {
  database: SQL;
  ownerId?: string;
}): Promise<string> {
  const syncId = Bun.randomUUIDv7();
  await database`
    insert into "record_sync"
      ("id", "owner_id", "readable_id", "name", "api_key_sha256", "created_at")
    values (${syncId}, ${ownerId}, 'source-notes', 'Source notes', ${new Bun.CryptoHasher('sha256').update(syncId).digest('hex')}, ${NOW})
  `;
  return syncId;
}

function deliveredRecord({
  revision = 1,
  id = 'meeting-42',
  content,
}: {
  revision?: number;
  id?: string;
  content?: Omit<RecordContent, 'title'> & { title?: string };
}): DeliveredRecord {
  const record = {
    eventId: `delivery-event-${revision}`,
    provider: 'calendar',
    sourceId: 'private-source-id',
    kind: 'meeting',
    id,
    revision,
    committedAt: NOW,
    contentHash: new Bun.CryptoHasher('sha256')
      .update(JSON.stringify(content ?? 'deleted'))
      .digest('hex'),
  };
  return content
    ? {
        ...record,
        operation: revision === 1 ? 'added' : 'updated',
        content: { title: 'Imported evidence', ...content },
      }
    : { ...record, operation: 'deleted' };
}

function acceptRecords({
  records,
  syncId,
  deliveries,
  ownerId = OWNER_A,
}: {
  records: RecordsService;
  syncId: string;
  deliveries: DeliveredRecord[];
  ownerId?: string;
}) {
  return records.accept({
    ownerId,
    syncId,
    envelope: { version: 1, batchId: 'batch', records: deliveries },
  });
}

interface RetrievalTestContext {
  assets: AssetsRepository;
  dataFolder: string;
  database: SQL;
  reader: SQL;
  entities: EntitiesRepository;
  pages: KnowledgePagesService;
  retrieval: HypermediaRetrievalService;
  records: RecordsService;
  storage: LocalStorage;
}

async function withRetrievalTest(
  run: (context: RetrievalTestContext) => Promise<void>,
): Promise<void> {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-retrieval-test-'));
  const database = await createSqliteDatabase({ dataFolder });
  let reader: SQL | undefined;
  try {
    await runMigrations({ db: database });
    for (const [id, email] of [
      [OWNER_A, 'owner-a@example.com'],
      [OWNER_B, 'owner-b@example.com'],
    ]) {
      await database`
        insert into "auth_user"
          ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
        values (${id}, ${id}, ${email}, 1, ${NOW}, ${NOW})
      `;
    }
    const storage = new LocalStorage(join(dataFolder, 'objects'));
    reader = createSqliteReader({ dataFolder });
    const retrievalRepository = new HypermediaRetrievalRepository({ database: reader, storage });
    const retrieval = new HypermediaRetrievalService({
      retrieval: retrievalRepository,
      hypermedia: new HypermediaRepository(reader),
    });
    const pagesRepository = new KnowledgePagesRepository(database);
    const recordsRepository = new RecordsRepository(database);
    const pages = new KnowledgePagesService({
      pages: pagesRepository,
      storage,
    });
    await run({
      assets: new AssetsRepository(database),
      dataFolder,
      database,
      reader,
      entities: new EntitiesRepository(database),
      pages,
      records: new RecordsService({ records: recordsRepository, storage }),
      storage,
      retrieval,
    });
  } finally {
    await Promise.all([database.close(), reader?.close()]);
    await rm(dataFolder, { recursive: true, force: true });
  }
}

async function createEntity({
  entities,
  ownerId = OWNER_A,
  readableId,
  name,
  description,
}: {
  entities: EntitiesRepository;
  ownerId?: string;
  readableId: string;
  name: string;
  description: string;
}): Promise<void> {
  const result = await entities.create({
    id: `${ownerId}-${readableId}`,
    ownerId,
    readableId,
    name,
    description,
    createdAt: NOW,
  });
  expect(result.state).toBe('created');
}

async function createAsset({
  assets,
  readableId,
  name,
}: {
  assets: AssetsRepository;
  readableId: string;
  name: string;
}): Promise<void> {
  const result = await assets.create({
    id: `asset-${readableId}`,
    ownerId: OWNER_A,
    readableId,
    name,
    mediaType: 'text/plain',
    extension: 'txt',
    sizeBytes: 1,
    storageKey: `${OWNER_A}/assets/${readableId}`,
    contentHash: 'a'.repeat(SHA256_HEX_LENGTH),
    createdAt: NOW,
    updatedAt: NOW,
  });
  expect(result.state).toBe('created');
}

test('concurrent searches coexist with canonical writes on a read-only connection', () =>
  withRetrievalTest(async ({ entities, retrieval, reader }) => {
    await createEntity({
      entities,
      readableId: 'target',
      name: 'Target',
      description: 'Committed needle evidence.',
    });
    const search = () => retrieval.search({ ownerId: OWNER_A, query: 'needle', limit: 1 });
    const [first, second, update] = await Promise.all([
      search(),
      search(),
      entities.update({
        ownerId: OWNER_A,
        readableId: 'target',
        name: 'Target',
        description: 'Updated needle evidence.',
        updatedAt: NOW,
      }),
    ]);
    expect(update?.description).toBe('Updated needle evidence.');
    for (const result of [first, second, await search()]) {
      expect(result.totalMatches).toBe(1);
      expect(result.truncated).toBe(false);
      expect(result.results[0]).toMatchObject({
        resourceType: 'entity',
        entity: { readableId: 'target' },
      });
    }
    await expect(
      Promise.resolve(reader.unsafe('delete from hypermedia_search_document')),
    ).rejects.toThrow(/readonly/i);
  }));

test('retrieval never observes uncommitted metadata or postings, including rolled-back writes', () =>
  withRetrievalTest(async ({ database, entities, retrieval }) => {
    await createEntity({
      entities,
      readableId: 'target',
      name: 'Target',
      description: 'Committed needle evidence.',
    });
    for (const commit of [false, true]) {
      const staged = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const rollback = new Error('Intentional rollback');
      const writing = database.begin(async (transaction) => {
        await transaction`update entity set description = 'Staged quartz evidence.'
          where owner_id = ${OWNER_A} and readable_id = 'target'`;
        await replaceSearchDocument({
          db: transaction,
          ownerId: OWNER_A,
          resourceType: 'entity',
          readableId: 'target',
          label: 'Target',
          summary: 'Staged quartz evidence.',
        });
        staged.resolve();
        await release.promise;
        if (!commit) {
          throw rollback;
        }
      });
      // Attach rejection handling before releasing the intentionally failing writer.
      const outcome = writing.then(
        () => null,
        (error: unknown) => error,
      );
      await staged.promise;
      try {
        const old = await retrieval.search({ ownerId: OWNER_A, query: 'needle', limit: 1 });
        expect(old).toMatchObject({
          totalMatches: 1,
          truncated: false,
          results: [
            { resourceType: 'entity', entity: { description: 'Committed needle evidence.' } },
          ],
        });
        expect(
          await retrieval.search({ ownerId: OWNER_A, query: 'quartz', limit: 1 }),
        ).toMatchObject({
          results: [],
          totalMatches: 0,
          truncated: false,
        });
      } finally {
        release.resolve();
        expect(await outcome).toBe(commit ? null : rollback);
      }
      expect(
        (await retrieval.search({ ownerId: OWNER_A, query: 'quartz', limit: 1 })).totalMatches,
      ).toBe(commit ? 1 : 0);
      expect(
        (await retrieval.search({ ownerId: OWNER_A, query: 'needle', limit: 1 })).totalMatches,
      ).toBe(commit ? 0 : 1);
    }
  }));

test.each([
  { time: undefined, expectedPages: ['undated'] },
  { time: '1968', expectedPages: [] },
  { time: '1969-12', expectedPages: ['before-epoch', 'ongoing'] },
  { time: '1970-01', expectedPages: ['at-epoch', 'ongoing'] },
  { time: '1970-02', expectedPages: ['after-epoch', 'ongoing'] },
  { time: '1970/..', expectedPages: ['after-epoch', 'at-epoch', 'ongoing'] },
])('map browsing and search apply time before pagination: %j', ({ time, expectedPages }) =>
  withRetrievalTest(async ({ entities, pages, reader, retrieval }) => {
    await createEntity({
      entities,
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
    const hypermedia = new HypermediaRepository(reader);
    const input = {
      ownerId: OWNER_A,
      resources: [{ kind: 'entity' as const, readableId: 'topic' }],
      visibleResources: [],
      kinds: ['entity' as const],
      limit: 1,
      temporalBounds: time ? temporalBoundsFrom(time) : undefined,
    };
    for (const load of [
      (offset: number) => hypermedia.pages({ ...input, offset }),
      (offset: number) => retrieval.searchPageView({ ...input, offset, query: 'needle' }),
    ]) {
      const readableIds: string[] = [];
      for (let offset = 0; offset <= expectedPages.length; offset += 1) {
        const result = await load(offset);
        readableIds.push(...result.pages.map((page) => page.readableId));
        expect(result.nextOffset).toBe(offset + 1 < expectedPages.length ? offset + 1 : null);
      }
      expect(readableIds.sort()).toEqual([...expectedPages]);
    }
  }),
);

test('excluded canvas resource kinds cannot crowd out eligible entity matches', () =>
  withRetrievalTest(async ({ entities, assets, pages, retrieval }) => {
    await createEntity({
      entities,
      readableId: 'target',
      name: 'Target',
      description: 'A specialist in needle research.',
    });
    await pages.create({
      ownerId: OWNER_A,
      actor: { kind: 'owner' },
      markdown:
        '# Context\n\nA useful association.\n\nWorking with [Target](context-use://entity/target).',
    });
    const input = {
      ownerId: OWNER_A,
      resources: [],
      visibleResources: [],
      kinds: ['entity' as const],
      query: 'needle',
      limit: 10,
      offset: 0,
    };
    const before = await retrieval.searchPageView(input);
    expect(before.pages.map((page) => page.readableId)).toEqual(['context']);
    expect(before.matchedResources).toEqual([
      { kind: 'entity', entity: expect.objectContaining({ readableId: 'target' }) },
    ]);
    for (let index = 0; index < MAX_HYPERMEDIA_SEARCH_LIMIT; index++) {
      await createAsset({ assets, readableId: `needle-${index}`, name: 'Needle' });
    }
    expect(await retrieval.searchPageView(input)).toEqual(before);
  }));

test('BM25 retrieves typed resources, body evidence, and pages containing both queried entities', () =>
  withRetrievalTest(async ({ assets, entities, pages, retrieval }) => {
    await createEntity({
      entities,
      readableId: 'luca',
      name: 'Luca',
      description: 'Product builder working on diabetes technology.',
    });
    await createEntity({
      entities,
      readableId: 'tidepool',
      name: 'Tidepool',
      description: 'A nonprofit building open diabetes tools.',
    });
    await createAsset({ assets, readableId: 'tidepool-diagram', name: 'Tidepool diagram' });
    const page = await pages.create({
      ownerId: OWNER_A,
      actor: { kind: 'owner' },
      markdown:
        '# Joining Tidepool\n\nA short account of a meaningful collaboration.\n\n[Luca](context-use://entity/luca) became involved with [Tidepool](context-use://entity/tidepool) through an open-source glucose project.',
      temporalCoverage: '2022',
    });
    expect(page.state).toBe('saved');

    const combined = await retrieval.search({
      ownerId: OWNER_A,
      query: 'Luca Tidepool',
      limit: 10,
    });
    expect(combined.results[0]).toEqual(
      expect.objectContaining({
        resourceType: 'knowledge_page',
        knowledgePage: expect.objectContaining({ readableId: 'joining-tidepool' }),
      }),
    );

    const bodyMatch = await retrieval.search({
      ownerId: OWNER_A,
      query: 'glucose',
      resourceTypes: ['knowledge_page'],
      limit: 10,
    });
    expect(bodyMatch.results).toEqual([
      expect.objectContaining({
        resourceType: 'knowledge_page',
        matchExcerpt: expect.stringContaining('glucose'),
      }),
    ]);
    expect(
      bodyMatch.results[0]?.resourceType === 'knowledge_page'
        ? bodyMatch.results[0].knowledgePage.excerpt
        : '',
    ).not.toContain('glucose');

    const excerptMatch = await retrieval.search({
      ownerId: OWNER_A,
      query: 'collaboration',
      resourceTypes: ['knowledge_page'],
      limit: 10,
    });
    expect(excerptMatch.results).toEqual([
      expect.objectContaining({ resourceType: 'knowledge_page', matchExcerpt: null }),
    ]);

    const entitiesOnly = await retrieval.search({
      ownerId: OWNER_A,
      query: 'diabetes',
      resourceTypes: ['entity'],
      limit: 10,
    });
    expect(entitiesOnly.results.length).toBe(2);
    expect(entitiesOnly.results.every(({ resourceType }) => resourceType === 'entity')).toBe(true);
  }));

test('retrieval isolates owners, replaces changed documents, and excludes archived resources', () =>
  withRetrievalTest(async ({ assets, entities, pages, retrieval }) => {
    await createEntity({
      entities,
      readableId: 'observatory',
      name: 'Private Constellation Observatory',
      description: 'An owner-specific astronomy project.',
    });
    await createEntity({
      entities,
      ownerId: OWNER_B,
      readableId: 'other-observatory',
      name: 'Private Constellation Observatory',
      description: 'A different owner project.',
    });
    expect(
      (
        await retrieval.search({
          ownerId: OWNER_B,
          query: 'astronomy',
          limit: 10,
        })
      ).results,
    ).toEqual([]);

    const updatedEntity = await entities.update({
      ownerId: OWNER_A,
      readableId: 'observatory',
      name: 'Private Nebula Observatory',
      description: 'An owner-specific astronomy project.',
      updatedAt: NOW,
    });
    expect(updatedEntity?.name).toBe('Private Nebula Observatory');
    expect(
      (await retrieval.search({ ownerId: OWNER_A, query: 'constellation', limit: 10 })).results,
    ).toEqual([]);
    expect(
      (await retrieval.search({ ownerId: OWNER_A, query: 'nebula', limit: 10 })).results,
    ).toEqual([
      expect.objectContaining({
        resourceType: 'entity',
        entity: expect.objectContaining({ readableId: 'observatory' }),
      }),
    ]);
    const archived = await entities.archive({
      ownerId: OWNER_A,
      readableId: 'observatory',
      archivedAt: NOW,
    });
    expect(archived.state).toBe('archived');
    expect(
      (await retrieval.search({ ownerId: OWNER_A, query: 'nebula', limit: 10 })).results,
    ).toEqual([]);

    await createAsset({ assets, readableId: 'field-notes', name: 'Obsolete codename notes' });
    const renamed = await assets.updateName({
      ownerId: OWNER_A,
      readableId: 'field-notes',
      name: 'Current codename notes',
      updatedAt: NOW,
    });
    expect(renamed?.name).toBe('Current codename notes');
    expect(
      (await retrieval.search({ ownerId: OWNER_A, query: 'obsolete', limit: 10 })).results,
    ).toEqual([]);
    expect(
      (await retrieval.search({ ownerId: OWNER_A, query: 'current', limit: 10 })).results,
    ).toEqual([
      expect.objectContaining({
        resourceType: 'asset',
        asset: expect.objectContaining({ readableId: 'field-notes' }),
      }),
    ]);
    const archivedAsset = await assets.archive({
      ownerId: OWNER_A,
      readableId: 'field-notes',
      archivedAt: NOW,
    });
    expect(archivedAsset.state).toBe('archived');
    expect(
      (await retrieval.search({ ownerId: OWNER_A, query: 'current', limit: 10 })).results,
    ).toEqual([]);

    const created = await pages.create({
      ownerId: OWNER_A,
      actor: { kind: 'owner' },
      markdown:
        '# Retrieval journal\n\nStable preview.\n\nThe oldlexeme describes the first draft.',
    });
    if (created.state !== 'saved') {
      throw new Error(`Could not create test page: ${created.state}`);
    }
    const updated = await pages.update({
      ownerId: OWNER_A,
      actor: { kind: 'owner' },
      readableId: created.page.readableId,
      expectedRevisionNumber: created.page.revisionNumber,
      markdown: '# Retrieval journal\n\nStable preview.\n\nThe newlexeme replaces the first draft.',
    });
    expect(updated.state).toBe('saved');
    expect(
      (await retrieval.search({ ownerId: OWNER_A, query: 'oldlexeme', limit: 10 })).results,
    ).toEqual([]);
    expect(
      (await retrieval.search({ ownerId: OWNER_A, query: 'newlexeme', limit: 10 })).results,
    ).toEqual([
      expect.objectContaining({
        resourceType: 'knowledge_page',
        knowledgePage: expect.objectContaining({ revisionNumber: 2 }),
      }),
    ]);
  }));

test('top-K ordering is deterministic', () =>
  withRetrievalTest(async ({ assets, retrieval }) => {
    for (const suffix of ['alpha', 'beta', 'gamma']) {
      await createAsset({ assets, readableId: `signal-${suffix}`, name: `Signal ${suffix}` });
    }
    const first = await retrieval.search({
      ownerId: OWNER_A,
      query: 'signal',
      resourceTypes: ['asset'],
      limit: 2,
    });
    const second = await retrieval.search({
      ownerId: OWNER_A,
      query: 'signal',
      resourceTypes: ['asset'],
      limit: 2,
    });
    expect(first.truncated).toBe(true);
    expect(first.totalMatches).toBe(SIGNAL_ASSET_COUNT);
    expect(
      first.results.flatMap((result) =>
        result.resourceType === 'asset' ? [result.asset.readableId] : [],
      ),
    ).toEqual(
      second.results.flatMap((result) =>
        result.resourceType === 'asset' ? [result.asset.readableId] : [],
      ),
    );
  }));

test('all four types are searchable, with record Markdown structure left intact', () =>
  withRetrievalTest(async ({ database, records, entities, assets, pages, retrieval }) => {
    const syncId = await createRecordSync({ database });
    const record = deliveredRecord({
      content: {
        body: '# Orchard meeting\n\nOpening paragraph.\n\n## Decisions\n\n> We **negotiated** access.\n\n- Distinctive first item\n- Tailneedle far beyond the introduction\n\n[Visiblelabel](https://hidden-destination.example) ![Photoalt](https://hidden-image.example)\n\n`excludedinline`\n\n```\nexcludedfence\n```',
        sourceUrl: 'https://private-source.example/hidden-source',
        sourceCreatedAt: '2021-03-04T00:00:00Z',
        participants: [
          {
            name: 'Samantha Wells',
            roles: ['organizer'],
            identities: [{ namespace: 'email', id: 'unindexedidentity@example.net' }],
          },
        ],
        attributes: {
          subject: 'Orchard planning',
          tags: ['irrigation', 'budget'],
          nested: { secret: 'nestedignored' },
        },
      },
    });
    expect(await acceptRecords({ records, syncId, deliveries: [record] })).toEqual({
      state: 'accepted',
    });
    await createEntity({
      entities,
      readableId: 'grower',
      name: 'A grower',
      description: 'Orchard restoration expert.',
    });
    await createAsset({ assets, readableId: 'orchard-map', name: 'Orchard map' });
    await pages.create({
      ownerId: OWNER_A,
      actor: { kind: 'owner' },
      markdown: '# Orchard plan\n\nRestore an orchard.',
    });

    const combined = await retrieval.search({ ownerId: OWNER_A, query: 'orchard', limit: 10 });
    expect(combined.results.map(({ resourceType }) => resourceType).sort()).toEqual([
      'asset',
      'entity',
      'knowledge_page',
      'record',
    ]);
    for (const query of [
      'tailneedle',
      'decisions',
      'visiblelabel',
      'photoalt',
      'negotiating',
      'samantha',
      'calendar',
    ]) {
      const result = await retrieval.search({
        ownerId: OWNER_A,
        query,
        resourceTypes: ['record'],
        limit: 10,
      });
      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        resourceType: 'record',
        matchExcerpt: expect.any(String),
      });
    }
    for (const query of [
      'hidden-destination',
      'hidden-image',
      'hidden-source',
      'excludedinline',
      'excludedfence',
      'nestedignored',
      'unindexedidentity@example.net',
      'organizer',
      'irrigation',
      'private-source-id',
    ]) {
      expect(
        (await retrieval.search({ ownerId: OWNER_A, query, resourceTypes: ['record'], limit: 10 }))
          .results,
      ).toEqual([]);
    }
    const media = await retrieval.search({
      ownerId: OWNER_A,
      query: 'text/plain',
      resourceTypes: ['asset'],
      limit: 10,
    });
    expect(media.results).toHaveLength(1);
    await assets.updateName({
      ownerId: OWNER_A,
      readableId: 'orchard-map',
      name: 'Renamed map',
      updatedAt: NOW,
    });
    expect(
      (
        await retrieval.search({
          ownerId: OWNER_A,
          query: 'txt',
          resourceTypes: ['asset'],
          limit: 10,
        })
      ).results,
    ).toHaveLength(1);

    // Both SQL queries and their snippets must work with database writes disabled.
    const readOnlyExpected = await retrieval.search({
      ownerId: OWNER_A,
      query: 'orchard',
      limit: 10,
    });
    await database`pragma query_only = on`;
    try {
      expect(await retrieval.search({ ownerId: OWNER_A, query: 'orchard', limit: 10 })).toEqual(
        readOnlyExpected,
      );
    } finally {
      await database`pragma query_only = off`;
    }
  }));

test('record metadata can be discovered lexically and used to filter candidates before top K', () =>
  withRetrievalTest(async ({ database, records, entities, retrieval }) => {
    const syncId = await createRecordSync({ database });
    const otherSync = await createRecordSync({ database, ownerId: OWNER_B });
    const deliveries = [
      ['mail-1', 'gmail', 'email', 'Alex Morgan'],
      ['mail-2', 'gmail', 'email', 'Samantha Wells'],
      ['notes-3', 'granola', 'meeting', 'Samantha Wells'],
      ['change-4', 'github', 'pull_request', 'Samantha Wells'],
    ].map(([id, provider, kind, name]) => ({
      ...deliveredRecord({
        id,
        content: {
          body: 'Scopeword discussed here.',
          participants: [{ name: name!, roles: [], identities: [] }],
        },
      }),
      provider: provider!,
      kind: kind!,
    }));
    await acceptRecords({ records, syncId, deliveries });
    await acceptRecords({ records, syncId: otherSync, ownerId: OWNER_B, deliveries });
    await createEntity({
      entities,
      readableId: 'scopeword',
      name: 'Scopeword',
      description: 'Scopeword.',
    });
    const search = (record: { provider?: string; kind?: string; participantName?: string }) =>
      retrieval.search({ ownerId: OWNER_A, query: 'scopeword', limit: 1, filters: { record } });
    await database`pragma query_only = on`;
    try {
      expect(await search({ provider: 'gmail' })).toMatchObject({
        totalMatches: 2,
        truncated: true,
      });
      expect(await search({ kind: 'email' })).toMatchObject({ totalMatches: 2, truncated: true });
      expect(await search({ participantName: 'samantha wells' })).toMatchObject({
        totalMatches: 3,
      });
      for (const [provider, kind, recordId] of [
        ['gmail', 'email', 'mail-2'],
        ['granola', 'meeting', 'notes-3'],
        ['github', 'pull_request', 'change-4'],
      ]) {
        expect(await search({ provider, kind, participantName: 'Samantha Wells' })).toMatchObject({
          results: [{ resourceType: 'record', record: { recordId } }],
          totalMatches: 1,
          truncated: false,
        });
      }
      for (const record of [
        { provider: 'gmail', kind: 'meeting' },
        { participantName: 'Samantha' },
        { participantName: "Samantha Wells' OR 1=1 --" },
        { provider: 'missing' },
      ]) {
        expect(await search(record)).toEqual({ results: [], totalMatches: 0, truncated: false });
      }
      expect(
        await retrieval.search({
          ownerId: OWNER_A,
          query: 'scopeword',
          limit: 1,
          resourceTypes: ['entity'],
          filters: { record: { provider: 'gmail' } },
        }),
      ).toEqual({ results: [], totalMatches: 0, truncated: false });
      expect(
        await retrieval.search({
          ownerId: OWNER_A,
          query: 'gmail granola github Samantha',
          limit: 10,
          resourceTypes: ['record'],
        }),
      ).toMatchObject({ totalMatches: 4, truncated: false });
    } finally {
      await database`pragma query_only = off`;
    }

    const revised = {
      ...deliveredRecord({
        id: 'notes-3',
        revision: 2,
        content: {
          body: 'Scopeword updated.',
          participants: [{ name: 'Alex Morgan', roles: [], identities: [] }],
        },
      }),
      provider: 'granola',
    };
    await acceptRecords({ records, syncId, deliveries: [revised, deliveries[2]!] });
    expect(await search({ provider: 'granola', participantName: 'Samantha Wells' })).toMatchObject({
      totalMatches: 0,
    });
    expect(await search({ provider: 'granola', participantName: 'Alex Morgan' })).toMatchObject({
      totalMatches: 1,
    });
    await acceptRecords({
      records,
      syncId,
      deliveries: [{ ...deliveredRecord({ id: 'notes-3', revision: 3 }), provider: 'granola' }],
    });
    expect(await search({ provider: 'granola' })).toMatchObject({ totalMatches: 0 });
  }));

test('record search tracks accepted revisions atomically, rejects conflicting metadata, and isolates owners', () =>
  withRetrievalTest(async ({ database, records, retrieval }) => {
    const syncId = await createRecordSync({ database });
    const otherSync = await createRecordSync({ database, ownerId: OWNER_B });
    const initial = deliveredRecord({
      content: {
        body: 'Originalneedle imported without an H1.',
        attributes: { subject: 'Oldmetadata' },
      },
    });
    expect(await acceptRecords({ records, syncId, deliveries: [initial] })).toEqual({
      state: 'accepted',
    });
    await acceptRecords({ records, syncId: otherSync, ownerId: OWNER_B, deliveries: [initial] });
    const search = (query: string) =>
      retrieval.search({ ownerId: OWNER_A, query, resourceTypes: ['record'], limit: 10 });
    const first = (await search('originalneedle')).results[0];
    if (first?.resourceType !== 'record') {
      throw new Error('Missing record search result');
    }
    const readableId = first.record.readableId;
    expect(first).not.toHaveProperty('title');
    expect(await records.findResource({ ownerId: OWNER_B, readableId })).toBeNull();

    const stored = await records.findResource({ ownerId: OWNER_A, readableId });
    expect(stored?.record.content).toMatchObject({
      attributes: { subject: 'Oldmetadata' },
    });
    // An identical replay preserves both canonical content and its searchable projection.
    await acceptRecords({ records, syncId, deliveries: [initial] });
    expect(await records.findResource({ ownerId: OWNER_A, readableId })).toEqual(stored);
    expect((await search('originalneedle')).results).toHaveLength(1);

    const updated = deliveredRecord({
      revision: 2,
      content: { body: 'Replacementneedle.', attributes: { subject: 'Newmetadata' } },
    });
    expect(await acceptRecords({ records, syncId, deliveries: [updated, initial] })).toEqual({
      state: 'accepted',
    });
    expect((await search('originalneedle oldmetadata')).results).toEqual([]);
    expect((await search('replacementneedle newmetadata')).results).toHaveLength(1);
    const conflicting = structuredClone(updated);
    if (conflicting.operation === 'deleted') {
      throw new Error('Expected current content');
    }
    conflicting.content.attributes = { subject: 'Conflictingmetadata' };
    expect(
      await acceptRecords({
        records,
        syncId,
        deliveries: [
          deliveredRecord({ id: 'rollback', content: { body: 'Rollbackneedle' } }),
          conflicting,
        ],
      }),
    ).toEqual({ state: 'conflict' });
    expect((await search('rollbackneedle conflictingmetadata')).results).toEqual([]);
    expect((await search('replacementneedle')).results).toHaveLength(1);
    await database`
      create trigger "fail_record_search_projection" before insert on "hypermedia_search_document"
      when new."resource_type" = 'record'
      begin select raise(abort, 'simulated index write failure'); end
    `;
    await expect(
      acceptRecords({
        records,
        syncId,
        deliveries: [deliveredRecord({ revision: 3, content: { body: 'Failedindexneedle' } })],
      }),
    ).rejects.toThrow('simulated index write failure');
    expect((await records.findResource({ ownerId: OWNER_A, readableId }))?.markdown).toBe(
      'Replacementneedle.',
    );
    expect((await search('failedindexneedle')).results).toEqual([]);
    expect((await search('replacementneedle')).results).toHaveLength(1);
    await database`drop trigger "fail_record_search_projection"`;
    // Revoking a delivery credential does not archive its previously received evidence.
    await database`update "record_sync" set "revoked_at" = ${NOW} where "id" = ${syncId}`;
    expect((await search('replacementneedle')).results).toHaveLength(1);
    await database`update "record_sync" set "revoked_at" = null where "id" = ${syncId}`;
    expect(
      await acceptRecords({
        records,
        syncId,
        deliveries: [deliveredRecord({ revision: 3 }), updated],
      }),
    ).toEqual({ state: 'accepted' });
    expect((await search('replacementneedle newmetadata')).results).toEqual([]);
    expect(await records.findResource({ ownerId: OWNER_A, readableId })).toBeNull();
    await acceptRecords({
      records,
      syncId,
      deliveries: [
        deliveredRecord({
          revision: 4,
          content: { title: 'Restored source', body: 'Reviveneedle only.' },
        }),
      ],
    });
    expect((await search('replacementneedle originalneedle')).results).toEqual([]);
    expect((await search('reviveneedle')).results).toMatchObject([
      { record: { readableId, title: 'Restored source' }, matchExcerpt: 'Reviveneedle only.' },
    ]);
    expect(
      (await retrieval.search({ ownerId: OWNER_B, query: 'originalneedle', limit: 10 })).results,
    ).toHaveLength(1);
  }));

test('page search applies the current interval contract before taking top K', () =>
  withRetrievalTest(async ({ pages, retrieval }) => {
    for (const [title, temporalCoverage] of [
      ['Undated', undefined],
      ['Earlier', '2021'],
      ['Current', '2025/..'],
    ] as const) {
      await pages.create({
        ownerId: OWNER_A,
        actor: { kind: 'owner' },
        markdown: `# ${title} intervalneedle\n\nRelevant account.`,
        temporalCoverage,
      });
    }
    const selected = await retrieval.search({
      ownerId: OWNER_A,
      query: 'intervalneedle',
      resourceTypes: ['knowledge_page'],
      limit: 1,
      filters: {
        knowledgePage: {
          interval: 'with',
          temporalBounds: {
            start: Date.parse('2025-01-01T00:00:00Z'),
            end: Date.parse('2026-01-01T00:00:00Z'),
          },
        },
      },
    });
    expect(selected).toMatchObject({
      totalMatches: 1,
      truncated: false,
      results: [
        { resourceType: 'knowledge_page', knowledgePage: { readableId: 'current-intervalneedle' } },
      ],
    });
    const undated = await retrieval.search({
      ownerId: OWNER_A,
      query: 'intervalneedle',
      resourceTypes: ['knowledge_page'],
      limit: 1,
      filters: { knowledgePage: { interval: 'without' } },
    });
    expect(undated).toMatchObject({
      totalMatches: 1,
      results: [{ knowledgePage: { readableId: 'undated-intervalneedle' } }],
    });
  }));

test('source titles share the page title field and outrank body-only record matches', () =>
  withRetrievalTest(async ({ database, records, pages, retrieval }) => {
    const syncId = await createRecordSync({ database });
    await acceptRecords({
      records,
      syncId,
      deliveries: [
        deliveredRecord({
          id: 'first',
          content: { title: 'Photometry', body: 'Ordinary source text.' },
        }),
        deliveredRecord({
          id: 'second',
          content: { title: 'Ordinary', body: 'Photometry source text.' },
        }),
      ],
    });
    expect(
      (
        await pages.create({
          ownerId: OWNER_A,
          actor: { kind: 'owner' },
          markdown: '# Photometry\n\nOrdinary source text.',
        })
      ).state,
    ).toBe('saved');
    const rows = await database<Array<{ resourceType: string }>>`
      select document."resource_type" as "resourceType" from "hypermedia_search_fts"
      join "hypermedia_search_document" document on document."id" = "hypermedia_search_fts"."rowid"
      where "hypermedia_search_fts" match 'label:photometry'
      order by document."resource_type"
    `;
    expect(rows.map((row) => row.resourceType)).toEqual(['knowledge_page', 'record']);
    const search = () =>
      retrieval.search({
        ownerId: OWNER_A,
        query: 'photometry',
        resourceTypes: ['record'],
        limit: 10,
      });
    expect((await search()).results).toMatchObject([
      { record: { title: 'Photometry', recordId: 'first' }, matchExcerpt: 'Photometry' },
      {
        record: { title: 'Ordinary', recordId: 'second' },
        matchExcerpt: expect.stringContaining('Photometry'),
      },
    ]);
    await acceptRecords({
      records,
      syncId,
      deliveries: [
        deliveredRecord({
          id: 'first',
          revision: 2,
          content: { title: 'Spectrometry', body: 'Ordinary source text.' },
        }),
      ],
    });
    expect((await search()).results).toMatchObject([{ record: { recordId: 'second' } }]);
    expect(
      (await retrieval.search({ ownerId: OWNER_A, query: 'spectrom', limit: 1 })).results,
    ).toMatchObject([{ record: { title: 'Spectrometry' }, matchExcerpt: 'Spectrometry' }]);
  }));

test('persistent search contains no stored text and hydrates only the top K files', () =>
  withRetrievalTest(async ({ database, records, pages, retrieval, storage }) => {
    const syncId = await createRecordSync({ database });
    await acceptRecords({
      records,
      syncId,
      deliveries: [
        deliveredRecord({
          id: 'first',
          content: { title: 'Hydration', body: 'Source-only text one.' },
        }),
        deliveredRecord({
          id: 'second',
          content: { title: 'Hydration', body: 'Source-only text two.' },
        }),
      ],
    });
    await pages.create({
      ownerId: OWNER_A,
      actor: { kind: 'owner' },
      markdown: '# Hydration\n\nSource-only page text.',
    });
    const columns = await database<
      Array<{ name: string }>
    >`pragma table_info('hypermedia_search_document')`;
    expect(columns.map((column) => column.name)).toEqual([
      'id',
      'owner_id',
      'resource_type',
      'readable_id',
      'participant_names',
    ]);
    const content = await database<
      Array<{ label: null; summary: null; body: null; metadata: null }>
    >`select "label", "summary", "body", "metadata" from "hypermedia_search_fts"`;
    const indexedResourceCount = 3;
    expect(content).toHaveLength(indexedResourceCount);
    expect(content.every((row) => Object.values(row).every((value) => value === null))).toBe(true);
    expect(
      await database<
        Array<{ name: string }>
      >`select "name" from sqlite_schema where "name" = 'hypermedia_search_fts_content'`,
    ).toEqual([]);
    const read = spyOn(storage, 'file');
    await database`pragma query_only = on`;
    try {
      const result = await retrieval.search({ ownerId: OWNER_A, query: 'hydration', limit: 1 });
      expect(result).toMatchObject({ totalMatches: 3, truncated: true });
      expect(result.results).toHaveLength(1);
      expect(read.mock.calls).toHaveLength(1);
    } finally {
      read.mockRestore();
      await database`pragma query_only = off`;
    }
  }));

test('snippets use native stemming, prefixes, accents and clustered body matches for pages and records', () =>
  withRetrievalTest(async ({ database, records, pages, retrieval }) => {
    const syncId = await createRecordSync({ database });
    const contextRepetitions = 80;
    const body = `Negotiated only. ${'Background context. '.repeat(contextRepetitions)}At the café, we negotiated superconductivity together. ${'Later material. '.repeat(contextRepetitions)}`;
    await acceptRecords({ records, syncId, deliveries: [deliveredRecord({ content: { body } })] });
    await pages.create({
      ownerId: OWNER_A,
      actor: { kind: 'owner' },
      markdown: `# Research\n\nStatic introduction.\n\n${body}`,
    });
    for (const query of ['negotiating cafe supercon', '"negotiating" OR cafe * supercon']) {
      const result = await retrieval.search({ ownerId: OWNER_A, query, limit: 10 });
      expect(result.results).toHaveLength(2);
      for (const hit of result.results) {
        expect(hit.matchExcerpt).toContain('café');
        expect(hit.matchExcerpt).toContain('negotiated');
        expect(hit.matchExcerpt).toContain('superconductivity');
        expect(hit.matchExcerpt?.length).toBeLessThanOrEqual(MAX_HYPERMEDIA_MATCH_EXCERPT_LENGTH);
      }
    }
    // Test each tokenizer rule independently: OR queries could hide drift behind another match.
    for (const [query, matchedText] of [
      ['negotiating', 'Negotiated'],
      ['cafe', 'café'],
      ['supercon', 'superconductivity'],
    ] as const) {
      const result = await retrieval.search({ ownerId: OWNER_A, query, limit: 10 });
      expect(result.results).toHaveLength(2);
      for (const hit of result.results) {
        expect(hit.matchExcerpt?.toLowerCase()).toContain(matchedText.toLowerCase());
      }
    }
  }));

test('record snippets and metadata remain pinned when an update or deletion follows ranking', () =>
  withRetrievalTest(async ({ database, records, retrieval, storage }) => {
    const syncId = await createRecordSync({ database });
    await acceptRecords({
      records,
      syncId,
      deliveries: [
        deliveredRecord({
          content: { title: 'Original title', body: 'Raceword original evidence.' },
        }),
      ],
    });
    const exists = storage.exists.bind(storage);
    const update = spyOn(storage, 'exists').mockImplementationOnce(async (key) => {
      await acceptRecords({
        records,
        syncId,
        deliveries: [
          deliveredRecord({
            revision: 2,
            content: { title: 'Revised title', body: 'Raceword replacement evidence.' },
          }),
        ],
      });
      return exists(key);
    });
    const search = () => retrieval.search({ ownerId: OWNER_A, query: 'raceword', limit: 10 });
    try {
      expect((await search()).results).toMatchObject([
        { record: { title: 'Original title' }, matchExcerpt: 'Raceword original evidence.' },
      ]);
    } finally {
      update.mockRestore();
    }
    expect((await search()).results).toMatchObject([
      { record: { title: 'Revised title' }, matchExcerpt: 'Raceword replacement evidence.' },
    ]);
    const deletion = spyOn(storage, 'exists').mockImplementationOnce(async (key) => {
      await acceptRecords({ records, syncId, deliveries: [deliveredRecord({ revision: 3 })] });
      return exists(key);
    });
    try {
      expect((await search()).results).toMatchObject([
        { record: { title: 'Revised title' }, matchExcerpt: 'Raceword replacement evidence.' },
      ]);
    } finally {
      deletion.mockRestore();
    }
    expect((await search()).results).toEqual([]);
  }));

test('page snippets stay on the ranked revision through updates and archival', () =>
  withRetrievalTest(async ({ pages, retrieval, storage }) => {
    const page = await pages.create({
      ownerId: OWNER_A,
      actor: { kind: 'owner' },
      markdown: '# Snapshot\n\nStatic excerpt.\n\nRaceword original evidence.',
    });
    if (page.state !== 'saved') {
      throw new Error('Page fixture failed');
    }
    const exists = storage.exists.bind(storage);
    const update = spyOn(storage, 'exists').mockImplementationOnce(async (key) => {
      expect(
        (
          await pages.update({
            ownerId: OWNER_A,
            actor: { kind: 'owner' },
            readableId: page.page.readableId,
            expectedRevisionNumber: 1,
            markdown: '# Snapshot\n\nStatic excerpt.\n\nRaceword replacement evidence.',
          })
        ).state,
      ).toBe('saved');
      return exists(key);
    });
    const search = () => retrieval.search({ ownerId: OWNER_A, query: 'raceword', limit: 10 });
    try {
      expect((await search()).results).toMatchObject([
        { knowledgePage: { revisionNumber: 1 }, matchExcerpt: 'Raceword original evidence.' },
      ]);
    } finally {
      update.mockRestore();
    }
    expect((await search()).results).toMatchObject([
      { knowledgePage: { revisionNumber: 2 }, matchExcerpt: 'Raceword replacement evidence.' },
    ]);
    const archive = spyOn(storage, 'exists').mockImplementationOnce(async (key) => {
      expect(
        (await pages.archive({ ownerId: OWNER_A, readableId: page.page.readableId })).state,
      ).toBe('archived');
      return exists(key);
    });
    try {
      expect((await search()).results).toMatchObject([
        { knowledgePage: { revisionNumber: 2 }, matchExcerpt: 'Raceword replacement evidence.' },
      ]);
    } finally {
      archive.mockRestore();
    }
    expect((await search()).results).toEqual([]);
  }));

test('missing or corrupt selected record files fail closed instead of returning misleading snippets', () =>
  withRetrievalTest(async ({ database, records, retrieval, storage }) => {
    const syncId = await createRecordSync({ database });
    await acceptRecords({
      records,
      syncId,
      deliveries: [deliveredRecord({ content: { body: 'Integrityneedle original evidence.' } })],
    });
    const rows = await database<
      Array<{ storageKey: string }>
    >`select "storage_key" as "storageKey" from "record"`;
    const key = rows[0]!.storageKey;
    await storage.write(key, new Blob(['Integrityneedle unrelated replacement']));
    await expect(
      retrieval.search({ ownerId: OWNER_A, query: 'integrityneedle', limit: 10 }),
    ).rejects.toThrow('integrity check');
    await storage.delete(key);
    await expect(
      retrieval.search({ ownerId: OWNER_A, query: 'integrityneedle', limit: 10 }),
    ).rejects.toThrow('is missing');
  }));

test('record snippets stay compact even when one matching token is very long', () =>
  withRetrievalTest(async ({ database, records, retrieval }) => {
    const syncId = await createRecordSync({ database });
    const longTokenLength = 5_000;
    await acceptRecords({
      records,
      syncId,
      deliveries: [
        deliveredRecord({
          content: {
            body: `Longtokenneedle${'x'.repeat(longTokenLength)}`,
          },
        }),
      ],
    });
    const result = await retrieval.search({
      ownerId: OWNER_A,
      query: 'longtokenneedle',
      limit: 10,
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.matchExcerpt).toContain('Longtokenneedle');
    expect(result.results[0]?.matchExcerpt?.length).toBeLessThanOrEqual(
      MAX_HYPERMEDIA_MATCH_EXCERPT_LENGTH,
    );
  }));

test('entity types filter candidates before ranking, counts, and pagination while preserving ownership', () =>
  withRetrievalTest(async ({ entities, retrieval, database, assets }) => {
    const create = async ({
      readableId,
      entityType,
      ownerId = OWNER_A,
    }: {
      readableId: string;
      entityType: EntityType | null;
      ownerId?: string;
    }) => {
      const result = await entities.create({
        id: `${ownerId}-${readableId}`,
        ownerId,
        readableId,
        name: readableId,
        description: 'needle',
        entityType,
        createdAt: NOW,
      });
      expect(result.state).toBe('created');
    };
    // These stronger name matches must not consume a people search's result limit.
    await create({ readableId: 'needle-organization', entityType: 'organization' });
    await create({ readableId: 'needle-location', entityType: 'location' });
    await create({ readableId: 'needle-untyped', entityType: null });
    await create({ readableId: 'alice', entityType: 'person' });
    await create({ readableId: 'zoe', entityType: 'person' });
    await create({ readableId: 'needle-private-person', entityType: 'person', ownerId: OWNER_B });
    await create({ readableId: 'needle-archived-person', entityType: 'person' });
    await entities.archive({
      ownerId: OWNER_A,
      readableId: 'needle-archived-person',
      archivedAt: NOW,
    });
    await createAsset({ assets, readableId: 'needle-file', name: 'needle' });

    const results = await retrieval.search({
      ownerId: OWNER_A,
      query: 'needle',
      limit: 1,
      filters: { entity: { type: 'person' } },
    });
    expect(results).toMatchObject({
      totalMatches: 2,
      truncated: true,
      results: [{ resourceType: 'entity', entity: { readableId: 'alice', entityType: 'person' } }],
    });
    const first = await entities.list({
      ownerId: OWNER_A,
      entityType: 'person',
      limit: 1,
      offset: 0,
    });
    expect(first).toMatchObject({
      total: 2,
      nextOffset: 1,
      items: [{ readableId: 'alice', entityType: 'person' }],
    });
    const second = await entities.list({
      ownerId: OWNER_A,
      entityType: 'person',
      limit: 1,
      offset: first.nextOffset!,
    });
    expect(second).toMatchObject({ total: 2, nextOffset: null, items: [{ readableId: 'zoe' }] });
    for (const entityType of ['organization', 'location', 'untyped', 'all'] as const) {
      const listed = await entities.list({ ownerId: OWNER_A, entityType, limit: 50, offset: 0 });
      const searched = await retrieval.search({
        ownerId: OWNER_A,
        query: 'needle',
        limit: 50,
        filters: { entity: { type: entityType } },
      });
      const expectedActiveEntities = 5;
      expect(listed.total).toBe(entityType === 'all' ? expectedActiveEntities : 1);
      expect(searched.totalMatches).toBe(listed.total);
      expect(searched.results.every((result) => result.resourceType === 'entity')).toBe(true);
      if (entityType === 'untyped') {
        expect(listed.items[0]?.entityType).toBeNull();
      }
    }
    // Persistent state cannot turn filter sentinels or arbitrary labels into types.
    for (const invalid of ['all', 'untyped', 'event', 'company']) {
      await expect(
        (async () => {
          await database`update "entity" set "entity_type" = ${invalid} where "id" = 'owner-a-alice'`;
        })(),
      ).rejects.toThrow();
    }
  }));

test('entity type updates preserve omissions, clear null, and immediately affect search', () =>
  withRetrievalTest(async ({ entities, retrieval }) => {
    await createEntity({ entities, readableId: 'alice', name: 'Alice', description: 'needle' });
    const update = {
      ownerId: OWNER_A,
      readableId: 'alice',
      name: 'Alice',
      description: 'needle',
      updatedAt: NOW,
    };
    expect((await entities.find(update))?.entityType).toBeNull();
    expect((await entities.update({ ...update, entityType: 'person' }))?.entityType).toBe('person');
    expect((await entities.update(update))?.entityType).toBe('person');
    expect(
      await entities.update({ ...update, ownerId: OWNER_B, entityType: 'location' }),
    ).toBeNull();
    expect((await entities.find(update))?.entityType).toBe('person');
    expect((await entities.update({ ...update, entityType: null }))?.entityType).toBeNull();
    const people = await retrieval.search({
      ownerId: OWNER_A,
      query: 'needle',
      limit: 1,
      filters: { entity: { type: 'person' } },
    });
    const untyped = await retrieval.search({
      ownerId: OWNER_A,
      query: 'needle',
      limit: 1,
      filters: { entity: { type: 'untyped' } },
    });
    expect(people.totalMatches).toBe(0);
    expect(untyped).toMatchObject({
      totalMatches: 1,
      results: [{ entity: { readableId: 'alice', entityType: null } }],
    });
  }));

test('self entities are created as people and cannot leave the people filter through an update', () =>
  withRetrievalTest(async ({ database, entities, retrieval }) => {
    const profiles = new KnowledgeProfilesRepository(database);
    const created = await profiles.create({
      ownerId: OWNER_A,
      entityId: 'self-entity',
      readableId: 'owner',
      name: 'Owner',
      description: 'needle',
      createdAt: NOW,
    });
    expect(created).toMatchObject({
      state: 'created',
      profile: { selfEntity: { entityType: 'person', isSelf: true } },
    });
    for (const entityType of [undefined, null, 'location', 'organization'] as const) {
      const updated = await entities.update({
        ownerId: OWNER_A,
        readableId: 'owner',
        name: 'Updated Owner',
        description: 'needle',
        entityType,
        updatedAt: NOW,
      });
      expect(updated).toMatchObject({ name: 'Updated Owner', entityType: 'person', isSelf: true });
    }
    expect(await profiles.find({ ownerId: OWNER_A })).toMatchObject({
      selfEntity: { entityType: 'person' },
    });
    for (const entityType of ['person', 'untyped', 'location', 'organization'] as const) {
      const listed = await entities.list({ ownerId: OWNER_A, entityType, limit: 1, offset: 0 });
      const searched = await retrieval.search({
        ownerId: OWNER_A,
        query: 'needle',
        limit: 1,
        filters: { entity: { type: entityType } },
      });
      expect(listed.total).toBe(entityType === 'person' ? 1 : 0);
      expect(searched.totalMatches).toBe(listed.total);
    }
  }));
