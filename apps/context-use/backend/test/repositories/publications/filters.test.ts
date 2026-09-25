import { expect, test } from 'bun:test';
import type { SQL } from 'bun';
import {
  parseTemporalCoverage,
  temporalBoundsFrom,
} from '#backend/models/knowledge-pages/temporal-coverage.ts';
import { AssetsRepository } from '#backend/repositories/assets/repository.ts';
import { EntitiesRepository } from '#backend/repositories/entities/repository.ts';
import { KnowledgePagesRepository } from '#backend/repositories/knowledge-pages/repository.ts';
import {
  type PublicationRequest,
  PublicationsRepository,
} from '#backend/repositories/publications/repository.ts';
import { HASH, LATER, NOW, withDatabase } from './database.ts';

async function change({ database, input }: { database: SQL; input: PublicationRequest }) {
  const publications = new PublicationsRepository(database);
  const preparation = await publications.prepare(input);
  expect(preparation?.blockers).toEqual([]);
  const result = await publications.execute({
    ...input,
    expectedState: preparation?.expectedState ?? '',
    publishedAt: NOW,
  });
  expect(result.state).toBe('changed');
  return result;
}

for (const resourceType of ['page', 'entity', 'asset'] as const) {
  test(`${resourceType} lists filter active publications before pagination and count within the owner`, () =>
    withDatabase(async ({ database }) => {
      const repository =
        resourceType === 'page'
          ? new KnowledgePagesRepository(database)
          : resourceType === 'entity'
            ? new EntitiesRepository(database)
            : new AssetsRepository(database);
      const input = { ownerId: 'owner-a', limit: 1, offset: 0 };
      const initial = await repository.list(input);
      expect(initial.total).toBe(2);
      const firstReadableId = initial.items[0]?.readableId ?? '';
      const publicReadableId = firstReadableId === 'primary' ? 'secondary' : 'primary';
      const request = {
        ownerId: 'owner-a',
        resourceType,
        readableId: publicReadableId,
        action: 'publish' as const,
        revisionNumber: 1,
      };
      await change({ database, input: request });
      // The other owner's publication uses the same readable ID as our private resource.
      await change({
        database,
        input: { ...request, ownerId: 'owner-b', readableId: firstReadableId },
      });
      expect(await repository.list({ ...input, visibility: 'public' })).toMatchObject({
        items: [{ readableId: publicReadableId }],
        total: 1,
        nextOffset: null,
      });
      expect(await repository.list({ ...input, visibility: 'private' })).toMatchObject({
        items: [{ readableId: firstReadableId }],
        total: 1,
        nextOffset: null,
      });
      expect(await repository.list({ ...input, visibility: 'all' })).toEqual(initial);
      expect(await repository.list({ ...input, visibility: 'public', offset: 1 })).toEqual({
        items: [],
        total: 1,
        nextOffset: null,
      });
      expect(
        await repository.list({ ...input, ownerId: 'owner-b', visibility: 'public' }),
      ).toMatchObject({
        items: [{ readableId: firstReadableId }],
        total: 1,
      });
      await change({ database, input: { ...request, readableId: firstReadableId } });
      expect(await repository.list({ ...input, visibility: 'public' })).toMatchObject({
        total: 2,
        nextOffset: 1,
      });
      expect(await repository.list({ ...input, visibility: 'public', offset: 1 })).toMatchObject({
        items: [{ readableId: publicReadableId }],
        total: 2,
        nextOffset: null,
      });
      await change({ database, input: { ...request, action: 'unpublish' } });
      expect(
        (await new PublicationsRepository(database).prepare(request))?.publication,
      ).toMatchObject({
        publicId: expect.any(String),
        publishedAt: null,
      });
      expect(await repository.list({ ...input, visibility: 'private' })).toMatchObject({
        items: [{ readableId: publicReadableId }],
        total: 1,
        nextOffset: null,
      });
      const archived = await repository.archive({
        ownerId: 'owner-a',
        readableId: publicReadableId,
        archivedAt: LATER,
        change: { clientName: null, message: 'Archive withdrawn fixture' },
      });
      expect(archived.state).toBe('archived');
      expect(await repository.list({ ...input, visibility: 'private' })).toEqual({
        items: [],
        total: 0,
        nextOffset: null,
      });
      expect((await repository.list(input)).total).toBe(1);
    }));
}

test('page visibility is independent of the current revision and composes with its temporal filters', () =>
  withDatabase(async ({ database }) => {
    const pages = new KnowledgePagesRepository(database);
    await change({
      database,
      input: {
        ownerId: 'owner-a',
        resourceType: 'page',
        readableId: 'primary',
        action: 'publish',
        revisionNumber: 1,
      },
    });
    const updated = await pages.update({
      ownerId: 'owner-a',
      readableId: 'primary',
      expectedRevisionNumber: 1,
      revisionId: 'private-revision',
      title: 'New private draft',
      excerpt: 'Private excerpt',
      searchableText: 'Private excerpt',
      temporalCoverage: parseTemporalCoverage('2026'),
      storageKey: 'private-key',
      contentHash: HASH,
      sizeBytes: 1,
      actor: { kind: 'owner' },
      message: 'Save unpublished changes',
      updatedAt: LATER,
      links: { entityReadableIds: [], recordReadableIds: [], pageReferences: [], assetUsages: [] },
    });
    expect(updated.state).toBe('updated');
    const input = { ownerId: 'owner-a', limit: 1, offset: 0, visibility: 'public' as const };
    expect(
      await pages.list({
        ...input,
        interval: 'with',
        temporalBounds: temporalBoundsFrom('2026-06'),
      }),
    ).toMatchObject({
      items: [{ readableId: 'primary', title: 'New private draft', revisionNumber: 2 }],
      total: 1,
    });
    for (const filter of [
      { interval: 'without' as const },
      { temporalBounds: temporalBoundsFrom('2025') },
    ]) {
      expect(await pages.list({ ...input, ...filter })).toEqual({
        items: [],
        total: 0,
        nextOffset: null,
      });
    }
    expect(
      await pages.list({ ...input, visibility: 'private', interval: 'without' }),
    ).toMatchObject({
      items: [{ readableId: 'secondary' }],
      total: 1,
    });
  }));

test('entity visibility composes with typed and untyped filters', () =>
  withDatabase(async ({ database }) => {
    await database`update entity set entity_type = 'person' where owner_id = 'owner-a' and readable_id = 'secondary'`;
    await change({
      database,
      input: {
        ownerId: 'owner-a',
        resourceType: 'entity',
        readableId: 'secondary',
        action: 'publish',
      },
    });
    const entities = new EntitiesRepository(database);
    const input = { ownerId: 'owner-a', limit: 1, offset: 0, visibility: 'public' as const };
    expect(await entities.list({ ...input, entityType: 'person' })).toMatchObject({
      items: [{ readableId: 'secondary' }],
      total: 1,
    });
    expect(await entities.list({ ...input, entityType: 'untyped' })).toEqual({
      items: [],
      total: 0,
      nextOffset: null,
    });
    expect(
      await entities.list({ ...input, visibility: 'private', entityType: 'untyped' }),
    ).toMatchObject({ items: [{ readableId: 'primary' }], total: 1 });
  }));

test('public image suggestions exclude non-images and images already assigned to entities', () =>
  withDatabase(async ({ database }) => {
    const assets = new AssetsRepository(database);
    await database`update asset set media_type = 'image/png' where owner_id = 'owner-a' and readable_id = 'secondary'`;
    for (const readableId of ['primary', 'secondary']) {
      await change({
        database,
        input: {
          ownerId: 'owner-a',
          resourceType: 'asset',
          readableId,
          action: 'publish',
        },
      });
    }
    const input = {
      ownerId: 'owner-a',
      limit: 1,
      offset: 0,
      visibility: 'public' as const,
      kind: 'entity_image' as const,
    };
    expect(await assets.list(input)).toMatchObject({
      items: [{ readableId: 'secondary' }],
      total: 1,
    });
    await database`update entity set image_asset_id = 'owner-a-asset-secondary' where owner_id = 'owner-a' and readable_id = 'primary'`;
    expect(await assets.list(input)).toEqual({ items: [], total: 0, nextOffset: null });
    expect((await assets.list({ ...input, kind: undefined })).total).toBe(2);
  }));
