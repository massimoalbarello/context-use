import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SQL } from 'bun';
import { createSqliteDatabase } from '#db/client.ts';
import { runMigrations } from '#db/migrate.ts';
import { LocalStorage } from '#lib/storage/local-storage.ts';
import { MAX_HYPERMEDIA_MATCH_EXCERPT_LENGTH } from '#models/hypermedia-retrieval/model.ts';
import type {
  DeliveredRecord,
  RecordContent,
} from '#models/records/delivery-contract.generated.ts';
import { AssetsRepository } from '#repositories/assets/repository.ts';
import { EntitiesRepository } from '#repositories/entities/repository.ts';
import { HypermediaRetrievalRepository } from '#repositories/hypermedia-retrieval/repository.ts';
import { KnowledgePagesRepository } from '#repositories/knowledge-pages/repository.ts';
import { RecordsRepository } from '#repositories/records/repository.ts';
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
  content?: RecordContent;
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
    ? { ...record, operation: revision === 1 ? 'added' : 'updated', content }
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
  entities: EntitiesRepository;
  pages: KnowledgePagesService;
  retrieval: HypermediaRetrievalService;
  records: RecordsService;
}

async function withRetrievalTest(
  run: (context: RetrievalTestContext) => Promise<void>,
): Promise<void> {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-retrieval-test-'));
  const database = await createSqliteDatabase({ dataFolder });
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
    const retrievalRepository = new HypermediaRetrievalRepository(database);
    const retrieval = new HypermediaRetrievalService(retrievalRepository);
    const pagesRepository = new KnowledgePagesRepository(database);
    const recordsRepository = new RecordsRepository(database);
    const pages = new KnowledgePagesService({
      pages: pagesRepository,
      retrieval,
      storage: new LocalStorage(join(dataFolder, 'objects')),
    });
    await run({
      assets: new AssetsRepository(database),
      dataFolder,
      database,
      entities: new EntitiesRepository(database),
      pages,
      records: new RecordsService({ records: recordsRepository }),
      retrieval,
    });
  } finally {
    await database.close();
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
            identities: [{ namespace: 'email', id: 'sam@example.net' }],
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
    for (const query of ['tailneedle', 'decisions', 'visiblelabel', 'photoalt', 'negotiating']) {
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
      'samantha',
      'sam@example.net',
      'organizer',
      'calendar',
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

test('record filters narrow candidates before top K without turning metadata into lexical matches', () =>
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
      ).toEqual({ results: [], totalMatches: 0, truncated: false });
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
    expect(stored?.metadata).toMatchObject({
      provider: 'calendar',
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
