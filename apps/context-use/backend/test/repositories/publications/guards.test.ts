import { expect, test } from 'bun:test';
import { AssetsRepository } from '#backend/repositories/assets/repository.ts';
import { EntitiesRepository } from '#backend/repositories/entities/repository.ts';
import { KnowledgePagesRepository } from '#backend/repositories/knowledge-pages/repository.ts';
import {
  type PublicationRequest,
  PublicationsRepository,
} from '#backend/repositories/publications/repository.ts';
import { LATER, NOW, withDatabase } from './database.ts';

const change = { clientName: null, message: 'Test publication guards' };
const target = { ownerId: 'owner-a', readableId: 'primary' };

async function transition({
  repository,
  input,
}: {
  repository: PublicationsRepository;
  input: PublicationRequest;
}) {
  const prepared = await repository.prepare(input);
  if (!prepared) {
    throw new Error('Expected publication target');
  }
  expect(
    await repository.execute({ ...input, expectedState: prepared.expectedState, publishedAt: NOW }),
  ).toMatchObject({ state: 'changed' });
}

for (const resourceType of ['page', 'entity', 'asset'] as const) {
  test(`${resourceType} archival requires withdrawal, preserves publication, and is owner scoped`, async () => {
    await withDatabase(async ({ database }) => {
      const publications = new PublicationsRepository(database);
      const resource = {
        page: new KnowledgePagesRepository(database),
        entity: new EntitiesRepository(database),
        asset: new AssetsRepository(database),
      }[resourceType];
      const request = { ...target, resourceType, action: 'publish' as const, revisionNumber: 1 };
      await transition({ repository: publications, input: request });
      const before = await publications.prepare(request);
      if (!before) {
        throw new Error('Expected published resource');
      }
      expect(await resource.archive({ ...target, archivedAt: LATER, change })).toEqual({
        state: 'resource_published',
      });
      expect(await publications.prepare(request)).toEqual(before);
      expect(
        await resource.archive({ ...target, ownerId: 'missing-owner', archivedAt: LATER, change }),
      ).toEqual({ state: 'not_found' });
      expect(
        await resource.archive({ ...target, ownerId: 'owner-b', archivedAt: LATER, change }),
      ).toEqual({ state: 'archived' });
      expect(await publications.prepare(request)).toEqual(before);
      await transition({
        repository: publications,
        input: { ...target, resourceType, action: 'unpublish' },
      });
      expect((await publications.prepare(request))?.publication).toEqual({
        publicId: before.publication.publicId,
        publishedAt: null,
      });
      expect(await resource.archive({ ...target, archivedAt: LATER, change })).toEqual({
        state: 'archived',
      });
      expect(await publications.prepare(request)).toBeNull();
    });
  });
}

test('public entity portraits accept only public assets and removal leaves the asset public', async () => {
  await withDatabase(async ({ database }) => {
    const publications = new PublicationsRepository(database);
    const entities = new EntitiesRepository(database);
    await transition({
      repository: publications,
      input: { ...target, resourceType: 'entity', action: 'publish' },
    });
    const before = await entities.find(target);
    const publication = await publications.entityStatus(target);
    const image = { ...target, assetId: 'owner-a-asset-primary', updatedAt: LATER, change };
    expect(await entities.setImage(image)).toEqual({ state: 'image_not_public' });
    expect(await entities.find(target)).toEqual(before);
    expect(await publications.entityStatus(target)).toEqual(publication);
    expect(await publications.assetStatus(target)).toEqual({ publicId: null, publishedAt: null });

    for (const assetId of ['missing', 'owner-b-asset-primary']) {
      expect(await entities.setImage({ ...image, assetId })).toEqual({ state: 'not_found' });
    }
    expect(await entities.setImage({ ...image, readableId: 'missing' })).toEqual({
      state: 'not_found',
    });
    await transition({
      repository: publications,
      input: { ...target, resourceType: 'asset', action: 'publish' },
    });
    const assetPublication = await publications.assetStatus(target);
    if (!assetPublication) {
      throw new Error('Expected published asset');
    }
    expect(await entities.setImage(image)).toMatchObject({
      state: 'updated',
      entity: { image: { readableId: 'primary' } },
    });
    expect(await entities.setImage(image)).toMatchObject({ state: 'updated' });
    expect(await entities.setImage({ ...image, assetId: 'owner-a-asset-secondary' })).toEqual({
      state: 'image_not_public',
    });
    expect((await entities.find(target))?.image?.readableId).toBe('primary');
    expect(await entities.removeImage({ ...target, updatedAt: LATER, change })).toMatchObject({
      image: null,
    });
    expect(await publications.assetStatus(target)).toEqual(assetPublication);
    expect(await publications.entityStatus(target)).toEqual(publication);

    await transition({
      repository: publications,
      input: { ...target, resourceType: 'asset', action: 'unpublish' },
    });
    expect(await entities.setImage(image)).toEqual({ state: 'image_not_public' });
    await transition({
      repository: publications,
      input: { ...target, resourceType: 'entity', action: 'unpublish' },
    });
    expect(await entities.setImage(image)).toMatchObject({ state: 'updated' });
    expect(await publications.assetStatus(target)).toEqual({
      publicId: assetPublication.publicId,
      publishedAt: null,
    });
  });
});

test('entity portrait assignment hides archived and foreign resources', async () => {
  await withDatabase(async ({ database }) => {
    const entities = new EntitiesRepository(database);
    const assets = new AssetsRepository(database);
    const image = { ...target, assetId: 'owner-a-asset-primary', updatedAt: LATER, change };
    expect(await assets.archive({ ...target, archivedAt: LATER, change })).toEqual({
      state: 'archived',
    });
    expect(await entities.setImage(image)).toEqual({ state: 'not_found' });
    expect(await entities.archive({ ...target, archivedAt: LATER, change })).toEqual({
      state: 'archived',
    });
    expect(await entities.setImage({ ...image, assetId: 'owner-a-asset-secondary' })).toEqual({
      state: 'not_found',
    });
    expect(await entities.setImage({ ...image, ownerId: 'owner-b' })).toEqual({
      state: 'not_found',
    });
  });
});
