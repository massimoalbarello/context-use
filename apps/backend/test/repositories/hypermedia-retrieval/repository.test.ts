import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SQL } from 'bun';
import { createSqliteDatabase } from '#db/client.ts';
import { runMigrations } from '#db/migrate.ts';
import { LocalStorage } from '#lib/storage/local-storage.ts';
import { AssetsRepository } from '#repositories/assets/repository.ts';
import { EntitiesRepository } from '#repositories/entities/repository.ts';
import { HypermediaRetrievalRepository } from '#repositories/hypermedia-retrieval/repository.ts';
import { KnowledgePagesRepository } from '#repositories/knowledge-pages/repository.ts';
import { HypermediaRetrievalService } from '#services/hypermedia-retrieval/service.ts';
import { KnowledgePagesService } from '#services/knowledge-pages/service.ts';

const OWNER_A = 'owner-a';
const OWNER_B = 'owner-b';
const NOW = '2026-09-08T12:00:00.000Z';
const SHA256_HEX_LENGTH = 64;
const SIGNAL_ASSET_COUNT = 3;

interface RetrievalTestContext {
  assets: AssetsRepository;
  database: SQL;
  entities: EntitiesRepository;
  pages: KnowledgePagesService;
  retrieval: HypermediaRetrievalService;
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
    const retrieval = new HypermediaRetrievalService(new HypermediaRetrievalRepository(database));
    const pagesRepository = new KnowledgePagesRepository(database);
    await run({
      assets: new AssetsRepository(database),
      database,
      entities: new EntitiesRepository(database),
      pages: new KnowledgePagesService({
        pages: pagesRepository,
        retrieval,
        storage: new LocalStorage(join(dataFolder, 'objects')),
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

test('top-K ordering is deterministic and an FTS rebuild converges from its text projection', () =>
  withRetrievalTest(async ({ assets, database, retrieval }) => {
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
      }>
    >`
      select "id", "readable_id" as "readableId", "label", "summary", "body"
      from "hypermedia_search_document"
      where "owner_id" = ${OWNER_A} and "resource_type" = 'asset'
        and "readable_id" = 'signal-alpha'
    `;
    if (!document) {
      throw new Error('Missing search projection');
    }
    await database`
      insert into "hypermedia_search_fts"
        ("hypermedia_search_fts", "rowid", "readable_id", "label", "summary", "body")
      values
        ('delete', ${document.id}, ${document.readableId}, ${document.label}, ${document.summary},
         ${document.body})
    `;
    const damaged = await retrieval.search({
      ownerId: OWNER_A,
      query: 'alpha',
      resourceTypes: ['asset'],
      limit: 10,
    });
    expect(damaged.results).toEqual([]);

    await retrieval.rebuildIndex();
    await retrieval.rebuildIndex();
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
