import { expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SQL } from 'bun';
import { createSqliteDatabase, createSqliteReader } from '#backend/db/client.ts';
import { runMigrations } from '#backend/db/migrate.ts';
import { LocalStorage } from '#backend/lib/storage/local-storage.ts';
import type { EntityType } from '#backend/models/entities/model.ts';
import { MAX_HYPERMEDIA_MATCH_EXCERPT_LENGTH } from '#backend/models/hypermedia-retrieval/model.ts';
import type { RecordDeletion, RecordInput } from '#backend/models/records/model.ts';
import { AssetsRepository } from '#backend/repositories/assets/repository.ts';
import { EntitiesRepository } from '#backend/repositories/entities/repository.ts';
import { HypermediaRetrievalRepository } from '#backend/repositories/hypermedia-retrieval/repository.ts';
import { KnowledgePagesRepository } from '#backend/repositories/knowledge-pages/repository.ts';
import { KnowledgeProfilesRepository } from '#backend/repositories/knowledge-profiles/repository.ts';
import { RecordsRepository } from '#backend/repositories/records/repository.ts';
import { replaceSearchDocument } from '#backend/repositories/search-index.ts';
import { HypermediaRetrievalService } from '#backend/services/hypermedia-retrieval/service.ts';
import { KnowledgePagesService } from '#backend/services/knowledge-pages/service.ts';
import { RecordsService } from '#backend/services/records/service.ts';

const OWNER_A = 'owner-a';
const OWNER_B = 'owner-b';
const MILLISECONDS_PER_SECOND = 1000;
const NOW = '2026-09-08T12:00:00.000Z';
const SHA256_HEX_LENGTH = 64;
const SIGNAL_ASSET_COUNT = 3;

function recordFixture({
  revision = 1,
  id = 'meeting-42',
  provider = 'calendar',
  kind = 'meeting',
  content,
}: {
  revision?: number;
  id?: string;
  provider?: string;
  kind?: string;
  content?: Omit<RecordInput, 'source' | 'title'> & { title?: string; sourceUrl?: string };
}): RecordInput | RecordDeletion {
  const source = { provider, kind, id };
  const sourceUpdatedAt = new Date(
    Date.parse(NOW) + revision * MILLISECONDS_PER_SECOND,
  ).toISOString();
  if (!content) {
    return { source, sourceUpdatedAt };
  }
  const { sourceUrl, ...fields } = content;
  return {
    title: 'Imported evidence',
    ...fields,
    source: { ...source, url: sourceUrl },
    sourceUpdatedAt,
  };
}
async function writeRecords({
  records,
  values,
  ownerId = OWNER_A,
}: {
  records: RecordsService;
  values: (RecordInput | RecordDeletion)[];
  ownerId?: string;
}) {
  for (const value of values) {
    const result =
      'body' in value
        ? await records.upsert({
            change: { clientName: null, message: 'Updated test context' },
            ownerId,
            record: value,
          })
        : await records.remove({
            change: { clientName: null, message: 'Updated test context' },
            ownerId,
            ...value,
          });
    expect(['created', 'updated', 'unchanged', 'stale']).toContain(result.state);
  }
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
    change: { clientName: null, message: 'Updated test context' },
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
    change: { clientName: null, message: 'Updated test context' },
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
        change: { clientName: null, message: 'Updated test context' },
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
      message: 'Updated test knowledge',
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
      change: { clientName: null, message: 'Updated test context' },
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
      change: { clientName: null, message: 'Updated test context' },
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
      change: { clientName: null, message: 'Updated test context' },
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
      change: { clientName: null, message: 'Updated test context' },
      ownerId: OWNER_A,
      readableId: 'field-notes',
      archivedAt: NOW,
    });
    expect(archivedAsset.state).toBe('archived');
    expect(
      (await retrieval.search({ ownerId: OWNER_A, query: 'current', limit: 10 })).results,
    ).toEqual([]);

    const created = await pages.create({
      message: 'Updated test knowledge',
      ownerId: OWNER_A,
      actor: { kind: 'owner' },
      markdown:
        '# Retrieval journal\n\nStable preview.\n\nThe oldlexeme describes the first draft.',
    });
    if (created.state !== 'saved') {
      throw new Error(`Could not create test page: ${created.state}`);
    }
    const updated = await pages.update({
      message: 'Updated test knowledge',
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
    const record = recordFixture({
      content: {
        body: '# Orchard meeting\n\nOpening paragraph.\n\n## Decisions\n\n> We **negotiated** access.\n\n- Distinctive first item\n- Tailneedle far beyond the introduction\n\n[Visiblelabel](https://hidden-destination.example) ![Photoalt](https://hidden-image.example)\n\n`excludedinline`\n\n```\nexcludedfence\n```',
        sourceUrl: 'https://private-source.example/hidden-source',
        sourceCreatedAt: '2021-03-04T00:00:00Z',
      },
    });
    await writeRecords({ records, values: [record] });
    await createEntity({
      entities,
      readableId: 'grower',
      name: 'A grower',
      description: 'Orchard restoration expert.',
    });
    await createAsset({ assets, readableId: 'orchard-map', name: 'Orchard map' });
    await pages.create({
      message: 'Updated test knowledge',
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
      change: { clientName: null, message: 'Updated test context' },
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

test('native provider and kind filters select records before top K and isolate owners', () =>
  withRetrievalTest(async ({ records, retrieval }) => {
    for (const ownerId of [OWNER_A, OWNER_B]) {
      for (const [id, provider, kind] of [
        ['mail-1', 'gmail', 'email'],
        ['mail-2', 'gmail', 'email'],
        ['notes-3', 'granola', 'meeting'],
      ]) {
        await writeRecords({
          records,
          ownerId,
          values: [recordFixture({ id, provider, kind, content: { body: 'Scopeword' } })],
        });
      }
    }
    const search = (record: { provider?: string; kind?: string }) =>
      retrieval.search({ ownerId: OWNER_A, query: 'scopeword', limit: 1, filters: { record } });
    expect(await search({ provider: 'gmail' })).toMatchObject({ totalMatches: 2, truncated: true });
    expect(await search({ provider: 'granola', kind: 'meeting' })).toMatchObject({
      totalMatches: 1,
      results: [{ record: { source: { id: 'notes-3' } } }],
    });
    expect(await search({ provider: 'gmail', kind: 'meeting' })).toMatchObject({ totalMatches: 0 });
  }));

test('page search applies the current interval contract before taking top K', () =>
  withRetrievalTest(async ({ pages, retrieval }) => {
    for (const [title, temporalCoverage] of [
      ['Undated', undefined],
      ['Earlier', '2021'],
      ['Current', '2025/..'],
    ] as const) {
      await pages.create({
        message: 'Updated test knowledge',
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
    await writeRecords({
      records,
      values: [
        recordFixture({
          id: 'first',
          content: { title: 'Photometry', body: 'Ordinary source text.' },
        }),
        recordFixture({
          id: 'second',
          content: { title: 'Ordinary', body: 'Photometry source text.' },
        }),
      ],
    });
    expect(
      (
        await pages.create({
          message: 'Updated test knowledge',
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
      { record: { title: 'Photometry', source: { id: 'first' } }, matchExcerpt: 'Photometry' },
      {
        record: { title: 'Ordinary', source: { id: 'second' } },
        matchExcerpt: expect.stringContaining('Photometry'),
      },
    ]);
    await writeRecords({
      records,
      values: [
        recordFixture({
          id: 'first',
          revision: 2,
          content: { title: 'Spectrometry', body: 'Ordinary source text.' },
        }),
      ],
    });
    expect((await search()).results).toMatchObject([{ record: { source: { id: 'second' } } }]);
    expect(
      (await retrieval.search({ ownerId: OWNER_A, query: 'spectrom', limit: 1 })).results,
    ).toMatchObject([{ record: { title: 'Spectrometry' }, matchExcerpt: 'Spectrometry' }]);
  }));

test('persistent search contains no stored text and hydrates only the top K files', () =>
  withRetrievalTest(async ({ database, records, pages, retrieval, storage }) => {
    await writeRecords({
      records,
      values: [
        recordFixture({
          id: 'first',
          content: { title: 'Hydration', body: 'Source-only text one.' },
        }),
        recordFixture({
          id: 'second',
          content: { title: 'Hydration', body: 'Source-only text two.' },
        }),
      ],
    });
    await pages.create({
      message: 'Updated test knowledge',
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
  withRetrievalTest(async ({ records, pages, retrieval }) => {
    const contextRepetitions = 80;
    const body = `Negotiated only. ${'Background context. '.repeat(contextRepetitions)}At the café, we negotiated superconductivity together. ${'Later material. '.repeat(contextRepetitions)}`;
    await writeRecords({ records, values: [recordFixture({ content: { body } })] });
    await pages.create({
      message: 'Updated test knowledge',
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
  withRetrievalTest(async ({ records, retrieval, storage }) => {
    await writeRecords({
      records,
      values: [
        recordFixture({
          content: { title: 'Original title', body: 'Raceword original evidence.' },
        }),
      ],
    });
    const exists = storage.exists.bind(storage);
    const update = spyOn(storage, 'exists').mockImplementationOnce(async (key) => {
      await writeRecords({
        records,
        values: [
          recordFixture({
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
      await writeRecords({ records, values: [recordFixture({ revision: 3 })] });
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
      message: 'Updated test knowledge',
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
            message: 'Updated test knowledge',
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
        (
          await pages.archive({
            change: { clientName: null, message: 'Updated test context' },
            ownerId: OWNER_A,
            readableId: page.page.readableId,
          })
        ).state,
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
    await writeRecords({
      records,
      values: [recordFixture({ content: { body: 'Integrityneedle original evidence.' } })],
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
  withRetrievalTest(async ({ records, retrieval }) => {
    const longTokenLength = 5_000;
    await writeRecords({
      records,
      values: [
        recordFixture({
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
        change: { clientName: null, message: 'Updated test context' },
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
      change: { clientName: null, message: 'Updated test context' },
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
    expect(
      (
        await entities.update({
          change: { clientName: null, message: 'Updated test context' },
          ...update,
          entityType: 'person',
        })
      )?.entityType,
    ).toBe('person');
    expect(
      (
        await entities.update({
          change: { clientName: null, message: 'Updated test context' },
          ...update,
        })
      )?.entityType,
    ).toBe('person');
    expect(
      await entities.update({
        change: { clientName: null, message: 'Updated test context' },
        ...update,
        ownerId: OWNER_B,
        entityType: 'location',
      }),
    ).toBeNull();
    expect((await entities.find(update))?.entityType).toBe('person');
    expect(
      (
        await entities.update({
          change: { clientName: null, message: 'Updated test context' },
          ...update,
          entityType: null,
        })
      )?.entityType,
    ).toBeNull();
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
      change: { clientName: null, message: 'Updated test context' },
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
        change: { clientName: null, message: 'Updated test context' },
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
