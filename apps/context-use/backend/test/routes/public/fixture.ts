import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import { createSqliteDatabase } from '#backend/db/client.ts';
import { runMigrations } from '#backend/db/migrate.ts';
import { elysiaErrorHandler } from '#backend/lib/errors.ts';
import { LocalStorage } from '#backend/lib/storage/local-storage.ts';
import { AssetsRepository } from '#backend/repositories/assets/repository.ts';
import { EntitiesRepository } from '#backend/repositories/entities/repository.ts';
import { KnowledgePagesRepository } from '#backend/repositories/knowledge-pages/repository.ts';
import { PublicResourcesRepository } from '#backend/repositories/public-resources/repository.ts';
import {
  type PublicationRequest,
  PublicationsRepository,
} from '#backend/repositories/publications/repository.ts';
import { RecordsRepository } from '#backend/repositories/records/repository.ts';
import { createPublicController } from '#backend/routes/public/controller.ts';
import { AssetsService } from '#backend/services/assets/service.ts';
import { KnowledgePagesService } from '#backend/services/knowledge-pages/service.ts';
import { PublicResourcesService } from '#backend/services/public-resources/service.ts';
import { RecordsService } from '#backend/services/records/service.ts';
import { unusedAssetFacesService } from '../../support/app.ts';

export const NOW = '2026-09-24T09:00:00.000Z';
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Z5sAAAAASUVORK5CYII=',
  'base64',
);
const ACTOR = { kind: 'owner' } as const;
export const CHANGE = { clientName: null, message: 'Test publication' };

export async function withPublicResources(
  run: (fixture: Awaited<ReturnType<typeof createFixture>>) => Promise<void>,
) {
  const folder = await mkdtemp(join(tmpdir(), 'context-use-public-resources-'));
  const database = await createSqliteDatabase({ dataFolder: folder });
  try {
    await runMigrations({ db: database });
    await run(await createFixture({ database, folder }));
  } finally {
    await database.close();
    await rm(folder, { recursive: true, force: true });
  }
}

async function createFixture({
  database,
  folder,
}: {
  database: Awaited<ReturnType<typeof createSqliteDatabase>>;
  folder: string;
}) {
  for (const owner of ['owner-a', 'owner-b']) {
    await database`insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
      values (${owner}, 'Private author name', ${`${owner}@example.invalid`}, 1, ${NOW}, ${NOW})`;
  }
  const storage = new LocalStorage(join(folder, 'objects'));
  const repository = new KnowledgePagesRepository(database);
  const pages = new KnowledgePagesService({ pages: repository, storage });
  const entities = new EntitiesRepository(database);
  const assets = new AssetsService({
    assets: new AssetsRepository(database),
    storage,
    faces: unusedAssetFacesService,
  });
  const records = new RecordsService({ records: new RecordsRepository(database), storage });
  const resources = new PublicResourcesRepository(database);
  const service = new PublicResourcesService({ resources, storage });
  const publications = new PublicationsRepository(database);
  const app = new Elysia()
    .onError(elysiaErrorHandler)
    .use(createPublicController({ publicResourcesService: service }));
  async function create({ markdown, ownerId = 'owner-a' }: { markdown: string; ownerId?: string }) {
    const result = await pages.create({
      ownerId,
      actor: ACTOR,
      message: 'Private creation message',
      markdown,
    });
    if (result.state !== 'saved') {
      throw new Error(JSON.stringify(result));
    }
    return result.page;
  }
  async function update({ readableId, markdown }: { readableId: string; markdown: string }) {
    const current = await pages.detail({ ownerId: 'owner-a', readableId });
    const result = await pages.update({
      ownerId: 'owner-a',
      readableId,
      actor: ACTOR,
      message: 'Private update message',
      markdown,
      expectedRevisionNumber: current!.revisionNumber,
    });
    if (result.state !== 'saved') {
      throw new Error(JSON.stringify(result));
    }
    return result.page;
  }
  async function transition(request: PublicationRequest) {
    const preparation = await publications.prepare(request);
    if (!preparation) {
      throw new Error('Missing preparation');
    }
    const result = await publications.execute({
      ...request,
      expectedState: preparation.expectedState,
      publishedAt: NOW,
    });
    if (result.state !== 'changed' || !result.publication.publicId) {
      throw new Error(JSON.stringify(result));
    }
    return result.publication.publicId;
  }
  const publish = ({
    readableId,
    revisionNumber = 1,
  }: {
    readableId: string;
    revisionNumber?: number;
  }) =>
    transition({
      ownerId: 'owner-a',
      resourceType: 'page',
      action: 'publish',
      readableId,
      revisionNumber,
    });
  const request = ({
    id,
    markdown = false,
    cookie,
    query = '',
  }: {
    id: string;
    markdown?: boolean;
    cookie?: string;
    query?: string;
  }) =>
    app.handle(
      new Request(
        `http://localhost/public/pages/${encodeURIComponent(id)}${markdown ? '/markdown' : ''}${query}`,
        { headers: cookie ? { cookie } : {} },
      ),
    );
  async function targets() {
    const page = await create({ markdown: '# Linked public page\n\nApproved linked content.' });
    const pageId = await publish({ readableId: page.readableId });
    const entityResult = await entities.create({
      id: Bun.randomUUIDv7(),
      ownerId: 'owner-a',
      readableId: 'private-entity-readable-id',
      name: 'Entity live name',
      description: 'Private description not used here',
      createdAt: NOW,
      change: CHANGE,
    });
    if (entityResult.state !== 'created') {
      throw new Error('Missing entity');
    }
    const entity = entityResult.entity;
    const entityId = await transition({
      ownerId: 'owner-a',
      resourceType: 'entity',
      action: 'publish',
      readableId: entity.readableId,
    });
    const assetResult = await assets.create({
      ownerId: 'owner-a',
      name: 'Private image name',
      file: new Blob([PNG]),
      change: CHANGE,
    });
    if (assetResult.state !== 'created') {
      throw new Error('Missing image');
    }
    const asset = assetResult.asset;
    const assetId = await transition({
      ownerId: 'owner-a',
      resourceType: 'asset',
      action: 'publish',
      readableId: asset.readableId,
    });
    return { page, pageId, entity, entityId, asset, assetId };
  }
  return {
    database,
    storage,
    repository,
    resources,
    publications,
    records,
    service,
    entities,
    assets,
    create,
    update,
    publish,
    transition,
    request,
    targets,
    app,
  };
}
