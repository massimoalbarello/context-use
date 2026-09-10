import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SQL } from 'bun';
import { createSqliteDatabase } from '#db/client.ts';
import { runMigrations } from '#db/migrate.ts';
import { LocalStorage } from '#lib/storage/local-storage.ts';
import { MAX_HYPERMEDIA_MATCH_EXCERPT_LENGTH } from '#models/hypermedia-retrieval/model.ts';
import { parseKnowledgePageMarkdown } from '#models/knowledge-pages/markdown.ts';
import type {
  DeliveredRecord,
  RecordContent,
} from '#models/records/delivery-contract.generated.ts';
import { AssetsRepository } from '#repositories/assets/repository.ts';
import { EntitiesRepository } from '#repositories/entities/repository.ts';
import { HypermediaRetrievalRepository } from '#repositories/hypermedia-retrieval/repository.ts';
import { KnowledgePagesRepository } from '#repositories/knowledge-pages/repository.ts';
import { RecordsRepository } from '#repositories/records/repository.ts';
import { HypermediaSearchMaintenanceService } from '#services/hypermedia-retrieval/maintenance.ts';
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
  maintenance: HypermediaSearchMaintenanceService;
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
      maintenance: new HypermediaSearchMaintenanceService({
        pages: pagesRepository,
        storage: new LocalStorage(join(dataFolder, 'objects')),
        records: recordsRepository,
        retrieval: retrievalRepository,
      }),
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

test('top-K ordering is deterministic and explicit maintenance repairs damaged postings', () =>
  withRetrievalTest(async ({ assets, database, retrieval, maintenance }) => {
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

    const [document] = await database<
      Array<{
        id: number;
        readableId: string;
        label: string;
        summary: string;
        body: string;
        metadata: string;
      }>
    >`
      select "id", "readable_id" as "readableId", "label", "summary", "body", "metadata"
      from "hypermedia_search_document"
      where "owner_id" = ${OWNER_A} and "resource_type" = 'asset'
        and "readable_id" = 'signal-alpha'
    `;
    if (!document) {
      throw new Error('Missing search projection');
    }
    await database`
      insert into "hypermedia_search_fts"
        ("hypermedia_search_fts", "rowid", "readable_id", "label", "summary", "body", "metadata")
      values
        ('delete', ${document.id}, ${document.readableId}, ${document.label}, ${document.summary},
         ${document.body}, ${document.metadata})
    `;
    const damaged = await retrieval.search({
      ownerId: OWNER_A,
      query: 'alpha',
      resourceTypes: ['asset'],
      limit: 10,
    });
    expect(damaged.results).toEqual([]);

    await maintenance.rebuild({ ownerId: OWNER_A });
    await maintenance.rebuild({ ownerId: OWNER_A });
    const rebuilt = await retrieval.search({
      ownerId: OWNER_A,
      query: 'alpha',
      resourceTypes: ['asset'],
      limit: 10,
    });
    expect(rebuilt.results).toEqual([
      expect.objectContaining({
        resourceType: 'asset',
        asset: expect.objectContaining({ readableId: 'signal-alpha' }),
      }),
    ]);
    const counts = await database<Array<{ total: number }>>`
      select count(*) as "total" from "hypermedia_search_document"
      where "owner_id" = ${OWNER_A}
    `;
    expect(Number(counts[0]?.total ?? 0)).toBe(SIGNAL_ASSET_COUNT);
  }));

test('all four types are searchable, including deep record Markdown and useful metadata', () =>
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
    for (const query of [
      'tailneedle',
      'decisions',
      'visiblelabel',
      'photoalt',
      'negotiating',
      'samantha',
      'sam@example.net',
      'organizer',
      'calendar',
      'irrigation',
      'meeting-42',
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
        title: 'Orchard meeting',
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
    expect(first.title).toBeNull();
    expect(await records.findResource({ ownerId: OWNER_B, readableId })).toBeNull();

    // Existing body-only records can acquire metadata on an identical replay, without changing
    // their recorded update time or pretending that the source event just happened.
    await database`update "record" set "metadata" = null where "owner_id" = ${OWNER_A}`;
    await acceptRecords({ records, syncId, deliveries: [initial] });
    const enriched = await records.findResource({ ownerId: OWNER_A, readableId });
    expect(enriched?.metadata).toMatchObject({
      provider: 'calendar',
      attributes: { subject: 'Oldmetadata' },
    });
    expect(enriched?.updatedAt).toBe(first.record.updatedAt);

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
    expect((await search('newmetadata')).results).toHaveLength(1);
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
    expect((await search('newmetadata')).results).toHaveLength(1);
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

test('explicit, restartable rebuild converges from canonical resources without rewriting another owner', () =>
  withRetrievalTest(
    async ({ database, dataFolder, records, entities, assets, pages, retrieval, maintenance }) => {
      const syncId = await createRecordSync({ database });
      await acceptRecords({
        records,
        syncId,
        deliveries: [deliveredRecord({ content: { body: 'Convergenceneedle from a record.' } })],
      });
      await createEntity({
        entities,
        readableId: 'convergence-person',
        name: 'Convergenceneedle',
        description: 'An indexed entity.',
      });
      await createAsset({ assets, readableId: 'convergence-asset', name: 'Convergenceneedle' });
      await pages.create({
        ownerId: OWNER_A,
        actor: { kind: 'owner' },
        markdown: '# Convergence page\n\nSummary.\n\nConvergenceneedle in the full body.',
      });
      await createEntity({
        entities,
        ownerId: OWNER_B,
        readableId: 'unaffected',
        name: 'Other',
        description: 'Other-owner evidence.',
      });
      const expected = await retrieval.search({
        ownerId: OWNER_A,
        query: 'convergenceneedle',
        limit: 10,
      });
      const otherBefore =
        await database`select * from "hypermedia_search_document" where "owner_id" = ${OWNER_B}`;
      await database`delete from "hypermedia_search_document" where "owner_id" = ${OWNER_A}`;
      await database`
      insert into "hypermedia_search_document" ("owner_id", "resource_type", "readable_id", "label", "summary", "body")
      values (${OWNER_A}, 'record', 'stale-record', 'Convergenceneedle', '', '')
    `;
      expect(
        (await retrieval.search({ ownerId: OWNER_A, query: 'convergenceneedle', limit: 10 }))
          .results,
      ).toEqual([]);
      let afterPage: string | undefined;
      await expect(
        maintenance.rebuild({
          ownerId: OWNER_A,
          onProgress: (progress) => {
            if (progress.resourceType === 'knowledge_page') {
              afterPage = progress.readableId;
              throw new Error('simulated interruption');
            }
          },
        }),
      ).rejects.toThrow('simulated interruption');
      await maintenance.rebuild({ ownerId: OWNER_A, afterPage });
      expect(
        await database`select "id" from "hypermedia_search_document" where "owner_id" = ${OWNER_A} and "readable_id" = 'stale-record'`,
      ).toHaveLength(0);
      expect(
        await retrieval.search({ ownerId: OWNER_A, query: 'convergenceneedle', limit: 10 }),
      ).toEqual(expected);
      await maintenance.rebuild({ ownerId: OWNER_A });
      expect(
        await retrieval.search({ ownerId: OWNER_A, query: 'convergenceneedle', limit: 10 }),
      ).toEqual(expected);
      expect(
        await database`select * from "hypermedia_search_document" where "owner_id" = ${OWNER_B}`,
      ).toEqual(otherBefore);
      const job = Bun.spawn(
        [
          process.execPath,
          fileURLToPath(new URL('../../../scripts/rebuild-hypermedia-search.ts', import.meta.url)),
          '--data-folder',
          dataFolder,
          '--owner-id',
          OWNER_A,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(job.stdout).text(),
        new Response(job.stderr).text(),
        job.exited,
      ]);
      expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' });
      expect(stdout).toContain('index integrity verified');
      expect(
        await retrieval.search({ ownerId: OWNER_A, query: 'convergenceneedle', limit: 10 }),
      ).toEqual(expected);
    },
  ));

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

test('maintenance cannot replace a newer page revision with a stale Markdown snapshot', () =>
  withRetrievalTest(async ({ database, pages, retrieval }) => {
    const markdown = '# Revision race\n\nA brief summary.\n\nOldsnapshotneedle.';
    await pages.create({ ownerId: OWNER_A, actor: { kind: 'owner' }, markdown });
    const repository = new KnowledgePagesRepository(database);
    const snapshot = await repository.find({ ownerId: OWNER_A, readableId: 'revision-race' });
    if (!snapshot) {
      throw new Error('Missing page snapshot');
    }
    expect(
      await pages.update({
        ownerId: OWNER_A,
        actor: { kind: 'owner' },
        readableId: snapshot.readableId,
        expectedRevisionNumber: 1,
        markdown: markdown.replace('Oldsnapshotneedle', 'Currentsnapshotneedle'),
      }),
    ).toMatchObject({ state: 'saved' });
    expect(
      await repository.replaceCurrentIndex({
        ownerId: OWNER_A,
        readableId: snapshot.readableId,
        expectedRevisionId: snapshot.currentRevisionId,
        ...parseKnowledgePageMarkdown(markdown),
      }),
    ).toEqual({ state: 'revision_changed' });
    expect(
      (await retrieval.search({ ownerId: OWNER_A, query: 'oldsnapshotneedle', limit: 10 })).results,
    ).toEqual([]);
    expect(
      (await retrieval.search({ ownerId: OWNER_A, query: 'currentsnapshotneedle', limit: 10 }))
        .results,
    ).toHaveLength(1);
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
