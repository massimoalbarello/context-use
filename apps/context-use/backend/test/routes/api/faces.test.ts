import { expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { StatusMap } from 'elysia';
import { createApp } from '#backend/app.ts';
import { createSqliteDatabase, createSynchronousSqliteDatabase } from '#backend/db/client.ts';
import { runMigrations } from '#backend/db/migrate.ts';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import type {
  AnalyzedFace,
  FaceAnalysis,
  FaceAnalyzer,
} from '#backend/lib/face-analysis/analyzer.ts';
import { LocalStorage } from '#backend/lib/storage/local-storage.ts';
import type { Asset } from '#backend/models/assets/model.ts';
import type { Entity } from '#backend/models/entities/model.ts';
import type { FaceModel } from '#backend/models/faces/model.ts';
import type { FaceModelStatus } from '#backend/models/faces/processing.ts';
import { AssetsRepository } from '#backend/repositories/assets/repository.ts';
import { EntitiesRepository } from '#backend/repositories/entities/repository.ts';
import { FacesRepository } from '#backend/repositories/faces/repository.ts';
import { HealthRepository } from '#backend/repositories/health/repository.ts';
import { HypermediaGraphRepository } from '#backend/repositories/hypermedia-graph/repository.ts';
import { KnowledgePagesRepository } from '#backend/repositories/knowledge-pages/repository.ts';
import { KnowledgeProfilesRepository } from '#backend/repositories/knowledge-profiles/repository.ts';
import { OwnerRegistrationRepository } from '#backend/repositories/owner-registration/repository.ts';
import { AssetFacesService } from '#backend/services/assets/faces.ts';
import { AssetsService } from '#backend/services/assets/service.ts';
import { EntitiesService } from '#backend/services/entities/service.ts';
import { HealthService } from '#backend/services/health/service.ts';
import { HypermediaGraphService } from '#backend/services/hypermedia-graph/service.ts';
import { KnowledgePagesService } from '#backend/services/knowledge-pages/service.ts';
import { KnowledgeProfilesService } from '#backend/services/knowledge-profiles/service.ts';
import { OwnerRegistrationService } from '#backend/services/owner-registration/service.ts';
import { unusedApiKeysService, unusedRecordsService } from '../../support/app.ts';
import { createTestHypermediaRetrievalService } from '../../support/hypermedia-retrieval.ts';
import {
  testMcpServerUrl,
  unusedAssetTransferCapabilities,
  unusedMcpClientAuthorizationsService,
  unusedMcpProtection,
  unusedMcpTransport,
} from '../../support/mcp.ts';
import { expectNoInternalResourceIds } from '../../support/public-api.ts';

const OWNER = 'face-owner';
const OTHER_OWNER = 'other-face-owner';
const PHOTO_PATH = resolve(import.meta.dir, '../../../../demo/fixtures/assets/steve-jobs-2010.jpg');
const FACE_LEFT = 0.1;
const FACE_TOP = 0.1;
const FACE_WIDTH = 0.3;
const FACE_HEIGHT = 0.4;
const SECOND_FACE_LEFT = 0.6;
const EXAMPLE_BOX = [FACE_LEFT, FACE_TOP, FACE_WIDTH, FACE_HEIGHT] as const;
const SECOND_BOX = [SECOND_FACE_LEFT, FACE_TOP, FACE_WIDTH, FACE_HEIGHT] as const;
const SIMILAR_FACE_X = 0.8;
const SIMILAR_FACE_Y = 0.6;
const THREE_ANALYSES = 3;
const PAGE_LIMIT = 10;
const ANALYSIS_TEST_TIMEOUT_MS = 2000;
const HIGH_THRESHOLD = 0.99;
const CONCURRENT_EDIT_HOLD_MS = 20;

function detectedFace(embedding: number[] = [1, 0]): AnalyzedFace {
  return {
    box: EXAMPLE_BOX,
    detectionScore: 0.9,
    embedding,
    crop: new Blob(['test crop'], { type: 'image/jpeg' }),
  };
}

class TestAnalyzer implements FaceAnalyzer {
  model: FaceModel = {
    name: 'Test faces',
    analysisVersion: 'test-v1',
    embeddingSpace: 'test-space-1',
    dimensions: 2,
    metric: 'cosine',
    defaultThreshold: 0.363,
    supportedMediaTypes: ['image/jpeg'],
  };
  status = async (): Promise<FaceModelStatus> => ({
    state: 'ready' as const,
    downloaded: true,
    error: null,
    checkedAt: null,
  });
  check = async () => {};
  next = [detectedFace()];
  resultModel: FaceAnalysis['model'] | null = null;
  failure: Error | null = null;
  wait: Promise<void> | null = null;
  calls = 0;
  lastImage: Blob | null = null;
  async analyze({ image }: Parameters<FaceAnalyzer['analyze']>[0]): Promise<FaceAnalysis> {
    this.calls++;
    this.lastImage = image;
    if (this.wait) {
      await this.wait;
    }
    if (this.failure) {
      throw this.failure;
    }
    return { model: this.resultModel ?? this.model, faces: this.next };
  }
}

async function fixture({ automatic = true } = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'context-use-faces-test-'));
  const database = await createSqliteDatabase({ dataFolder: folder });
  await runMigrations({ db: database });
  const faceDatabase = createSynchronousSqliteDatabase({ dataFolder: folder });
  const timestamp = new Date().toISOString();
  for (const owner of [OWNER, OTHER_OWNER]) {
    await database`insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values (${owner}, ${owner}, ${`${owner}@test.invalid`}, 1, ${timestamp}, ${timestamp})`;
  }
  const analyzer = new TestAnalyzer();
  const storage = new LocalStorage(join(folder, 'objects'));
  const crops = new LocalStorage(join(folder, 'face-crops'));
  const assetsRepository = new AssetsRepository(database);
  const entitiesRepository = new EntitiesRepository(database);
  const pagesRepository = new KnowledgePagesRepository(database);
  const repository = new FacesRepository(faceDatabase);
  const dependencies = {
    repository,
    assets: assetsRepository,
    entities: entitiesRepository,
    storage,
    crops,
    analyzer,
  };
  const faces = new AssetFacesService(dependencies);
  if (automatic) {
    faces.startProcessing();
  }
  const assets = new AssetsService({
    assets: assetsRepository,
    storage,
    faces,
  });
  const entities = new EntitiesService({
    assets: assetsRepository,
    entities: entitiesRepository,
    pages: pagesRepository,
    onPersonPortraitAvailable: (input) => faces.preparePortrait(input),
  });
  const auth: Auth = {
    passkeyOrigins: [],
    handler: () => Promise.resolve(new Response(null, { status: 404 })),
    getSession: ({ headers }) => {
      const owner = headers.get('x-test-owner');
      if (!owner) {
        return Promise.resolve(null);
      }
      const now = new Date();
      return Promise.resolve({
        user: {
          id: owner,
          name: owner,
          email: `${owner}@test.invalid`,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
        session: {
          id: 'session',
          userId: owner,
          token: 'test',
          expiresAt: new Date('2099-01-01'),
          createdAt: now,
          updatedAt: now,
        },
      });
    },
    protectMcpRequest: unusedMcpProtection,
  };
  const app = createApp({
    auth,
    assetsService: assets,
    entitiesService: entities,
    assetTransferCapabilities: unusedAssetTransferCapabilities,
    frontendAssetsService: { routes: () => new Map(), fallback: () => null },
    healthService: new HealthService(new HealthRepository(database)),
    graphService: new HypermediaGraphService({ graph: new HypermediaGraphRepository(database) }),
    retrievalService: createTestHypermediaRetrievalService({ database, storage }),
    mcpClientAuthorizationsService: unusedMcpClientAuthorizationsService,
    mcpServerUrl: testMcpServerUrl,
    mcpTransport: unusedMcpTransport,
    ownerRegistrationService: new OwnerRegistrationService(
      new OwnerRegistrationRepository(database),
    ),
    pagesService: new KnowledgePagesService({ pages: pagesRepository, storage }),
    profilesService: new KnowledgeProfilesService(new KnowledgeProfilesRepository(database)),
    recordsService: unusedRecordsService,
    apiKeysService: unusedApiKeysService,
  });
  return {
    folder,
    database,
    repository,
    reference: (entity: Entity) =>
      repository.referenceFace({ ownerId: OWNER, entityId: entity.id }),
    analyzer,
    faces,
    assets,
    entities,
    dependencies,
    request(options: { path: string; method?: string; body?: unknown; owner?: string | null }) {
      const headers = new Headers();
      if (options.owner !== null) {
        headers.set('x-test-owner', options.owner ?? OWNER);
      }
      if (options.body !== undefined) {
        headers.set('content-type', 'application/json');
      }
      return app.handle(
        new Request(`http://localhost/api${options.path}`, {
          method: options.method ?? 'GET',
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        }),
      );
    },
    async upload(name: string): Promise<Asset> {
      const result = await assets.create({ ownerId: OWNER, name, file: Bun.file(PHOTO_PATH) });
      if (result.state !== 'created') {
        throw new Error('Test asset creation failed');
      }
      if (!automatic) {
        await faces.process({ ownerId: OWNER, readableId: result.asset.readableId });
      }
      const deadline = Date.now() + ANALYSIS_TEST_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const analysis = await faces.detail({
          ownerId: OWNER,
          readableId: result.asset.readableId,
        });
        if (analysis?.state === 'ready' || analysis?.state === 'failed') {
          return result.asset;
        }
        await Bun.sleep(1);
      }
      throw new Error('Analysis did not settle');
    },
    async assignPortrait(input: { personReadableId: string; assetReadableId: string }) {
      const result = await entities.setImage({
        ownerId: OWNER,
        readableId: input.personReadableId,
        assetReadableId: input.assetReadableId,
      });
      if (result.state !== 'updated') {
        throw new Error('Portrait assignment failed');
      }
      const deadline = Date.now() + ANALYSIS_TEST_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (await repository.referenceFace({ ownerId: OWNER, entityId: result.entity.id })) {
          return;
        }
        await Bun.sleep(1);
      }
      throw new Error('Reference did not settle');
    },
    async person(name = 'Alice'): Promise<Entity> {
      const result = await entities.create({
        ownerId: OWNER,
        name,
        description: 'Test person',
        entityType: 'person',
      });
      if (result.state !== 'created') {
        throw new Error('Test entity creation failed');
      }
      return result.entity;
    },
    async [Symbol.asyncDispose]() {
      await faces.close();
      await faceDatabase.close();
      await database.close();
      await rm(folder, { recursive: true, force: true });
    },
  };
}

function holdNextMatch({ repository, assetId }: { repository: FacesRepository; assetId: string }) {
  const entered = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const matchAsset = repository.matchAsset.bind(repository);
  let held = false;
  repository.matchAsset = async (input) => {
    if (input.assetId === assetId && !held) {
      held = true;
      entered.resolve();
      await released.promise;
    }
    return matchAsset(input);
  };
  return { entered: entered.promise, release: () => released.resolve() };
}

test('a new portrait matches earlier unknown faces and exposes links in both directions without crop assets', async () => {
  await using context = await fixture();
  const schema =
    await context.database`select type from sqlite_schema where name = 'asset_depicts_entity'`;
  expect(schema).toEqual([{ type: 'table' }]);
  context.analyzer.next = [detectedFace([SIMILAR_FACE_X, SIMILAR_FACE_Y])];
  const photo = await context.upload('Earlier photo');
  const before = await context.faces.detail({ ownerId: OWNER, readableId: photo.readableId });
  expect(before?.faces[0]?.entity).toBeNull();
  context.analyzer.next = [detectedFace()];
  const portrait = await context.upload('Portrait');
  const person = await context.person();
  const selected = await context.request({
    path: `/entities/${person.readableId}/image`,
    method: 'PUT',
    body: { assetReadableId: portrait.readableId },
  });
  expect(selected.status).toBe(StatusMap.OK);
  const deadline = Date.now() + ANALYSIS_TEST_TIMEOUT_MS;
  while (
    !(await context.faces.detail({ ownerId: OWNER, readableId: photo.readableId }))?.faces[0]
      ?.entity &&
    Date.now() < deadline
  ) {
    await Bun.sleep(1);
  }
  const read = await context.request({ path: `/assets/${photo.readableId}/faces` });
  const detail = (await read.json()) as { faces: Array<{ readableId: string }> };
  expect(detail).toMatchObject({
    state: 'ready',
    faces: [
      {
        decision: 'automatic',
        entity: { readableId: person.readableId },
        similarity: expect.any(Number),
      },
    ],
  });
  expectNoInternalResourceIds(detail);
  const assetResponse = await context.request({ path: `/assets/${photo.readableId}` });
  expect(await assetResponse.json()).toMatchObject({
    depicts: [{ source: 'detected', entity: { readableId: person.readableId } }],
  });
  const images = await context.request({ path: `/entities/${person.readableId}/images` });
  expect(
    ((await images.json()) as { items: Array<{ readableId: string }> }).items
      .map((image: { readableId: string }) => image.readableId)
      .sort(),
  ).toEqual([photo.readableId, portrait.readableId].sort());
  const assets = await context.assets.list({ ownerId: OWNER, limit: PAGE_LIMIT, offset: 0 });
  expect(assets.total).toBe(2);
  expect((await readdir(join(context.folder, 'face-crops', OWNER, photo.id))).length).toBe(1);
  const crop = await context.request({
    path: `/assets/${photo.readableId}/faces/${detail.faces[0]!.readableId}/crop`,
  });
  expect(crop.status).toBe(StatusMap.OK);
  expect(crop.headers.get('content-type')).toBe('image/jpeg');
  const confirmation = await context.request({
    path: `/assets/${photo.readableId}/faces/${detail.faces[0]!.readableId}/annotation`,
    method: 'PUT',
    body: { decision: 'person', entityReadableId: person.readableId },
  });
  expect(confirmation.status).toBe(StatusMap.OK);
  const confirmedAsset = await context.request({ path: `/assets/${photo.readableId}` });
  expect(await confirmedAsset.json()).toMatchObject({
    depicts: [{ source: 'confirmed', entity: { readableId: person.readableId } }],
  });
});

test('a confirmed face can become the same person’s portrait and match earlier unknown faces', async () => {
  await using context = await fixture();
  const photo = await context.upload('Earlier photo');
  const portrait = await context.upload('Confirmed portrait');
  const person = await context.person();
  const input = { ownerId: OWNER, readableId: portrait.readableId };
  const face = (await context.faces.detail(input))!.faces[0]!;
  await context.faces.annotate({
    ...input,
    faceReadableId: face.readableId,
    decision: 'person',
    entityReadableId: person.readableId,
  });
  await context.assignPortrait({
    personReadableId: person.readableId,
    assetReadableId: portrait.readableId,
  });
  expect(
    (await context.faces.detail({ ownerId: OWNER, readableId: photo.readableId }))!.faces[0]!.entity
      ?.readableId,
  ).toBe(person.readableId);
  await context.faces.process(input);
  expect(await context.reference(person)).toBe(face.readableId);
  expect((await context.faces.detail(input))!.faces[0]!.decision).toBe('person');
});

test('changing an entity with an image to Person enrolls its portrait and matches earlier photos', async () => {
  await using context = await fixture();
  const photo = await context.upload('Earlier photo');
  const portrait = await context.upload('Portrait');
  const created = await context.entities.create({
    ownerId: OWNER,
    name: 'Unclassified entity',
    description: 'An entity with an image',
    entityType: null,
  });
  if (created.state !== 'created') {
    throw new Error('Test entity creation failed');
  }
  const person = created.entity;
  await context.entities.setImage({
    ownerId: OWNER,
    readableId: person.readableId,
    assetReadableId: portrait.readableId,
  });
  expect(await context.reference(person)).toBeNull();
  const response = await context.request({
    path: `/entities/${person.readableId}`,
    method: 'PATCH',
    body: { name: person.name, description: person.description, entityType: 'person' },
  });
  expect(response.status).toBe(StatusMap.OK);
  const analysis = await context.faces.detail({ ownerId: OWNER, readableId: portrait.readableId });
  expect(await context.reference(person)).toBe(analysis!.faces[0]!.readableId);
  expect(
    (await context.faces.detail({ ownerId: OWNER, readableId: photo.readableId }))!.faces[0]!.entity
      ?.readableId,
  ).toBe(person.readableId);
});

test('threshold saves affect subsequent matches; explicit re-matching preserves all human decisions', async () => {
  await using context = await fixture();
  const person = await context.person();
  const portrait = await context.upload('Portrait');
  await context.assignPortrait({
    personReadableId: person.readableId,
    assetReadableId: portrait.readableId,
  });
  context.analyzer.next = [detectedFace([SIMILAR_FACE_X, SIMILAR_FACE_Y])];
  const photo = await context.upload('Photo');
  const input = { ownerId: OWNER, readableId: photo.readableId };
  const face = (await context.faces.detail(input))!.faces[0]!;
  await context.faces.saveThreshold({ ownerId: OWNER, threshold: HIGH_THRESHOLD, rematch: false });
  expect((await context.faces.detail(input))!.faces[0]!.entity?.readableId).toBe(person.readableId);
  const calls = context.analyzer.calls;
  await context.faces.saveThreshold({ ownerId: OWNER, threshold: HIGH_THRESHOLD, rematch: true });
  expect(context.analyzer.calls).toBe(calls);
  expect((await context.faces.detail(input))!.faces[0]!.entity).toBeNull();
  for (const decision of ['person', 'unknown', 'dismissed'] as const) {
    await context.faces.annotate({
      ...input,
      faceReadableId: face.readableId,
      decision,
      entityReadableId: decision === 'person' ? person.readableId : undefined,
    });
    await context.faces.saveThreshold({ ownerId: OWNER, threshold: 0, rematch: true });
    expect((await context.faces.detail(input))!.faces[0]!.decision).toBe(decision);
  }
  await context.faces.annotate({
    ...input,
    faceReadableId: face.readableId,
    decision: 'automatic',
  });
  expect((await context.faces.detail(input))!.faces[0]!.entity?.readableId).toBe(person.readableId);
});

test('the analyzer receives verified image bytes with their media type independently of storage naming', async () => {
  await using context = await fixture();
  const file = context.dependencies.storage.file.bind(context.dependencies.storage);
  context.dependencies.storage.file = (key) =>
    new Blob([file(key)], { type: 'application/octet-stream' });
  const photo = await context.upload('Portable image input');
  expect(context.analyzer.lastImage!.type).toBe(photo.mediaType);
  expect(await context.analyzer.lastImage!.bytes()).toEqual(await Bun.file(PHOTO_PATH).bytes());
});

test.each(['analysisVersion', 'embeddingSpace'] as const)(
  'results from a different %s cannot be labeled with the configured model, even with equal dimensions',
  async (field) => {
    await using context = await fixture();
    context.analyzer.resultModel = { ...context.analyzer.model, [field]: 'other-model' };
    const photo = await context.upload('Mismatched model');
    const input = { ownerId: OWNER, readableId: photo.readableId };
    expect(await context.faces.detail(input)).toMatchObject({ state: 'failed', faces: [] });
    expect(await context.repository.observations({ ownerId: OWNER, assetId: photo.id })).toEqual(
      [],
    );
    expect((await context.assets.content(input))?.blob.size).toBe(photo.sizeBytes);
    context.analyzer.resultModel = null;
    expect(await context.faces.process(input)).toMatchObject({ state: 'ready' });
  },
);

test.each([
  { reason: 'wrong vector dimensions', invalid: detectedFace([1, 0, 0]) },
  { reason: 'non-finite stored vector', invalid: detectedFace([Number.MAX_VALUE, 0]) },
  { reason: 'zero vector', invalid: detectedFace([0, 0]) },
  { reason: 'out-of-bounds box', invalid: { ...detectedFace(), box: [1, 0, 1, 1] as const } },
  {
    reason: 'different crop format',
    invalid: { ...detectedFace(), crop: new Blob(['crop'], { type: 'image/png' }) },
  },
])(
  'invalid inference output ($reason) preserves existing faces, crops and decisions',
  async ({ invalid }) => {
    await using context = await fixture();
    const person = await context.person();
    const photo = await context.upload('Reviewed image');
    const input = { ownerId: OWNER, readableId: photo.readableId };
    const original = (await context.faces.detail(input))!.faces[0]!;
    await context.faces.annotate({
      ...input,
      faceReadableId: original.readableId,
      decision: 'person',
      entityReadableId: person.readableId,
    });
    const before = await context.repository.observations({ ownerId: OWNER, assetId: photo.id });
    const cropFiles = await readdir(join(context.folder, 'face-crops'), { recursive: true });
    // A valid first result must not be written before the invalid second result is rejected.
    context.analyzer.next = [detectedFace(), invalid];
    expect(await context.faces.process(input)).toMatchObject({ state: 'failed' });
    expect(await context.repository.observations({ ownerId: OWNER, assetId: photo.id })).toEqual(
      before,
    );
    expect(new Set(await readdir(join(context.folder, 'face-crops'), { recursive: true }))).toEqual(
      new Set(cropFiles),
    );
    expect(
      await context.faces.images({
        ownerId: OWNER,
        entityReadableId: person.readableId,
        offset: 0,
      }),
    ).toMatchObject({ items: [expect.objectContaining({ readableId: photo.readableId })] });
  },
);

test('face settings expose the editing contract without inference implementation details', async () => {
  await using context = await fixture();
  const response = await context.request({ path: '/face-recognition/settings' });
  expect(response.status).toBe(StatusMap.OK);
  expect(await response.json()).toEqual({
    threshold: context.analyzer.model.defaultThreshold,
    model: {
      analysisVersion: context.analyzer.model.analysisVersion,
      defaultThreshold: context.analyzer.model.defaultThreshold,
    },
  });
});

test('saved uploads survive analysis failure, interrupted attempts and model unavailability', async () => {
  await using context = await fixture();
  context.analyzer.failure = new Error('Model unavailable');
  const photo = await context.upload('Saved even when recognition fails');
  const input = { ownerId: OWNER, readableId: photo.readableId };
  expect(await context.faces.detail(input)).toMatchObject({
    state: 'failed',
    error: 'Face analysis failed. Retry this image.',
  });
  expect((await context.assets.content(input))?.blob.size).toBe(photo.sizeBytes);
  context.analyzer.failure = null;
  await context.faces.process(input);
  expect((await context.faces.detail(input))?.state).toBe('ready');
  await context.repository.begin({
    ownerId: OWNER,
    assetId: photo.id,
    analysisVersion: context.analyzer.model.analysisVersion,
    contentHash: 'interrupted',
    attemptId: 'interrupted',
    updatedAt: new Date().toISOString(),
  });
  const restarted = new AssetFacesService(context.dependencies);
  expect(await restarted.detail(input)).toMatchObject({
    state: 'queued',
    error: null,
  });
  await restarted.process(input);
  expect((await restarted.detail(input))?.state).toBe('ready');
});

test('reprocessing retains corrections when detections move or disappear, including edits during inference', async () => {
  await using context = await fixture();
  const person = await context.person();
  const photo = await context.upload('Photo');
  const input = { ownerId: OWNER, readableId: photo.readableId };
  const face = (await context.faces.detail(input))!.faces[0]!;
  const deferred = Promise.withResolvers<void>();
  context.analyzer.wait = deferred.promise;
  const processing = context.faces.process(input);
  // Wait on the real persisted boundary, not a timer guess, before editing the existing face.
  for (;;) {
    if (
      (
        await context.repository.detail({
          ownerId: OWNER,
          assetId: photo.id,
          analysisVersion: context.analyzer.model.analysisVersion,
        })
      ).state === 'processing'
    ) {
      break;
    }
    await Bun.sleep(1);
  }
  await context.faces.annotate({
    ...input,
    faceReadableId: face.readableId,
    decision: 'person',
    entityReadableId: person.readableId,
  });
  context.analyzer.next = [{ ...detectedFace(), box: SECOND_BOX }];
  deferred.resolve();
  await processing;
  const result = (await context.faces.detail(input))!;
  expect(result.faces).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        readableId: face.readableId,
        decision: 'person',
        needsReview: true,
        entity: expect.objectContaining({ readableId: person.readableId }),
      }),
    ]),
  );
  expect(
    (await context.faces.images({
      ownerId: OWNER,
      entityReadableId: person.readableId,
      offset: 0,
    }))!.items.map((asset) => asset.readableId),
  ).toContain(photo.readableId);
});

test('an incompatible embedding space cannot match even with the same dimensions; reprocessing the reference restores matching', async () => {
  await using context = await fixture({ automatic: false });
  const person = await context.person();
  const portrait = await context.upload('Portrait');
  await context.assignPortrait({
    personReadableId: person.readableId,
    assetReadableId: portrait.readableId,
  });
  context.analyzer.model = {
    ...context.analyzer.model,
    analysisVersion: 'test-v2',
    embeddingSpace: 'test-space-2',
  };
  const photo = await context.upload('New model photo');
  const input = { ownerId: OWNER, readableId: photo.readableId };
  expect((await context.faces.detail(input))!.faces[0]!.entity).toBeNull();
  expect(
    (await context.faces.detail({ ownerId: OWNER, readableId: portrait.readableId }))!.outdated,
  ).toBe(true);
  await context.faces.process({ ownerId: OWNER, readableId: portrait.readableId });
  expect((await context.faces.detail(input))!.faces[0]!.entity?.readableId).toBe(person.readableId);
});

test('face reads, crops and corrections enforce asset and person ownership', async () => {
  await using context = await fixture();
  const person = await context.person();
  const photo = await context.upload('Private photo');
  const face = (await context.faces.detail({ ownerId: OWNER, readableId: photo.readableId }))!
    .faces[0]!;
  for (const path of [
    `/assets/${photo.readableId}/faces`,
    `/assets/${photo.readableId}/faces/${face.readableId}/crop`,
    `/entities/${person.readableId}/images`,
  ]) {
    expect((await context.request({ path: path, owner: OTHER_OWNER })).status).toBe(
      StatusMap['Not Found'],
    );
    expect((await context.request({ path: path, owner: null })).status).toBe(
      StatusMap.Unauthorized,
    );
  }
  expect(
    (
      await context.request({
        path: `/assets/${photo.readableId}/faces/${face.readableId}/annotation`,
        method: 'PUT',
        owner: OTHER_OWNER,
        body: { decision: 'person', entityReadableId: person.readableId },
      })
    ).status,
  ).toBe(StatusMap['Not Found']);
  expect(
    (
      await context.request({
        path: '/face-recognition/settings',
        method: 'PUT',
        body: {
          threshold: 2,
          rematch: true,
          analysisVersion: context.analyzer.model.analysisVersion,
        },
      })
    ).status,
  ).toBe(StatusMap['Bad Request']);
  expect(
    (
      await context.request({
        path: '/face-recognition/settings',
        method: 'PUT',
        body: { threshold: 0.3, rematch: true, analysisVersion: 'obsolete' },
      })
    ).status,
  ).toBe(StatusMap.Conflict);
  expect(
    (await context.faces.detail({ ownerId: OWNER, readableId: photo.readableId }))!.faces[0]!
      .decision,
  ).toBe('automatic');
});

test('reviewing a face selects it in a group portrait; leaving it unknown does not enroll a different face', async () => {
  await using context = await fixture();
  const person = await context.person();
  context.analyzer.next = [detectedFace(), { ...detectedFace([0, 1]), box: SECOND_BOX }];
  const portrait = await context.upload('Group portrait');
  await context.entities.setImage({
    ownerId: OWNER,
    readableId: person.readableId,
    assetReadableId: portrait.readableId,
  });
  expect(await context.reference(person)).toBeNull();
  const face = (await context.faces.detail({ ownerId: OWNER, readableId: portrait.readableId }))!
    .faces[0]!;
  await context.faces.annotate({
    ownerId: OWNER,
    readableId: portrait.readableId,
    faceReadableId: face.readableId,
    decision: 'person',
    entityReadableId: person.readableId,
  });
  context.analyzer.next = [detectedFace()];
  const photo = await context.upload('Photo');
  const input = { ownerId: OWNER, readableId: photo.readableId };
  expect((await context.faces.detail(input))!.faces[0]!.entity?.readableId).toBe(person.readableId);
  await context.faces.annotate({
    ownerId: OWNER,
    readableId: portrait.readableId,
    faceReadableId: face.readableId,
    decision: 'unknown',
  });
  expect((await context.faces.detail(input))!.faces[0]!.entity).toBeNull();
  context.analyzer.next = [detectedFace(), { ...detectedFace([0, 1]), box: SECOND_BOX }];
  await context.faces.process({ ownerId: OWNER, readableId: portrait.readableId });
  expect(await context.reference(person)).toBeNull();
});

test.each(['unknown', 'dismissed', 'person'] as const)(
  'retrying a portrait preserves a conflicting %s decision without enrolling it again',
  async (decision) => {
    await using context = await fixture();
    const person = await context.person();
    const portrait = await context.upload('Portrait');
    const input = { ownerId: OWNER, readableId: portrait.readableId };
    await context.assignPortrait({
      personReadableId: person.readableId,
      assetReadableId: portrait.readableId,
    });
    const face = (await context.faces.detail(input))!.faces[0]!;
    const otherPerson = decision === 'person' ? await context.person('Bob') : null;
    await context.faces.annotate({
      ...input,
      faceReadableId: face.readableId,
      decision,
      entityReadableId: otherPerson?.readableId,
    });
    context.analyzer.model = {
      ...context.analyzer.model,
      analysisVersion: 'test-v2',
      embeddingSpace: 'test-space-2',
    };
    context.analyzer.next = [detectedFace([0, 1])];
    await context.faces.process(input);
    const reviewed = (await context.faces.detail(input))!.faces[0]!;
    expect(reviewed.decision).toBe(decision);
    expect(reviewed.entity?.readableId ?? null).toBe(otherPerson?.readableId ?? null);
    const stored = await context.repository.observations({ ownerId: OWNER, assetId: portrait.id });
    expect(stored[0]).toMatchObject({ embedding: [0, 1], embeddingSpace: 'test-space-2' });
    expect(await context.reference(person)).toBeNull();
  },
);

test.each([
  { before: [1, 0], after: [1, 0], matched: true },
  { before: [1, 0], after: [0, 1], matched: false },
  { before: [0, 1], after: [1, 0], matched: true },
])('overlapping rematches use the latest portrait: %j', async ({ before, after, matched }) => {
  await using context = await fixture();
  const person = await context.person();
  context.analyzer.next = [detectedFace([...before])];
  const portrait = await context.upload('Portrait');
  await context.assignPortrait({
    personReadableId: person.readableId,
    assetReadableId: portrait.readableId,
  });
  context.analyzer.next = [detectedFace()];
  const photo = await context.upload('Photo');
  const input = { ownerId: OWNER, readableId: photo.readableId };
  const held = holdNextMatch({ repository: context.repository, assetId: photo.id });
  const rematching = context.faces.rematch({ ownerId: OWNER });
  await held.entered;
  try {
    context.analyzer.next = [detectedFace([...after])];
    await context.faces.process({ ownerId: OWNER, readableId: portrait.readableId });
    expect((await context.assets.detail(input))!.depicts).toHaveLength(Number(matched));
  } finally {
    held.release();
    await rematching;
  }
  expect((await context.assets.detail(input))!.depicts).toHaveLength(Number(matched));
  expect((await context.faces.detail(input))!.faces[0]!.entity?.readableId ?? null).toBe(
    matched ? person.readableId : null,
  );
});

test('saving an upload finishes while inference is still running', async () => {
  await using context = await fixture();
  const deferred = Promise.withResolvers<void>();
  context.analyzer.wait = deferred.promise;
  try {
    const result = await context.assets.create({
      ownerId: OWNER,
      name: 'Immediate save',
      file: Bun.file(PHOTO_PATH),
    });
    expect(result.state).toBe('created');
    if (result.state !== 'created') {
      throw new Error('Expected a stored image');
    }
    expect(
      (await context.assets.content({ ownerId: OWNER, readableId: result.asset.readableId }))?.blob
        .size,
    ).toBe(result.asset.sizeBytes);
  } finally {
    deferred.resolve();
  }
});

test('choosing a different person for a reused portrait retires its previous reference identity', async () => {
  await using context = await fixture();
  const first = await context.person('First person');
  const second = await context.person('Second person');
  const portrait = await context.upload('Reused portrait');
  await context.assignPortrait({
    personReadableId: first.readableId,
    assetReadableId: portrait.readableId,
  });
  const face = (await context.faces.detail({ ownerId: OWNER, readableId: portrait.readableId }))!
    .faces[0]!;
  await context.entities.removeImage({ ownerId: OWNER, readableId: first.readableId });
  await context.entities.setImage({
    ownerId: OWNER,
    readableId: second.readableId,
    assetReadableId: portrait.readableId,
  });
  await context.faces.annotate({
    ownerId: OWNER,
    readableId: portrait.readableId,
    faceReadableId: face.readableId,
    decision: 'person',
    entityReadableId: second.readableId,
  });
  await context.entities.removeImage({ ownerId: OWNER, readableId: second.readableId });
  await context.entities.setImage({
    ownerId: OWNER,
    readableId: first.readableId,
    assetReadableId: portrait.readableId,
  });
  expect(await context.reference(first)).toBeNull();
  expect(
    (await context.faces.detail({ ownerId: OWNER, readableId: portrait.readableId }))!.faces[0]!
      .entity?.readableId,
  ).toBe(second.readableId);
  expect(await context.reference(second)).toBeNull();
});

test('face corrections wait for a concurrent canonical writer without holding a competing write lock', async () => {
  await using context = await fixture();
  const person = await context.person();
  const photo = await context.upload('Concurrent correction');
  const face = (await context.faces.detail({ ownerId: OWNER, readableId: photo.readableId }))!
    .faces[0]!;
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const edit = context.database.begin(async (db) => {
    await db`update "entity" set "description" = 'Edited during face review' where "owner_id" = ${OWNER} and "id" = ${person.id}`;
    started.resolve();
    await release.promise;
  });
  await started.promise;
  const correction = context.faces.annotate({
    ownerId: OWNER,
    readableId: photo.readableId,
    faceReadableId: face.readableId,
    decision: 'person',
    entityReadableId: person.readableId,
  });
  try {
    await Bun.sleep(CONCURRENT_EDIT_HOLD_MS);
  } finally {
    release.resolve();
  }
  const [, saved] = await Promise.all([edit, correction]);
  expect(saved).toBe(true);
  expect(
    (await context.faces.detail({ ownerId: OWNER, readableId: photo.readableId }))!.faces[0]!.entity
      ?.description,
  ).toBe('Edited during face review');
});

test('a delayed rematch uses the latest saved threshold', async () => {
  await using context = await fixture();
  const person = await context.person();
  const portrait = await context.upload('Threshold reference');
  await context.assignPortrait({
    personReadableId: person.readableId,
    assetReadableId: portrait.readableId,
  });
  context.analyzer.next = [detectedFace([SIMILAR_FACE_X, SIMILAR_FACE_Y])];
  const photo = await context.upload('Threshold race');
  const held = holdNextMatch({ repository: context.repository, assetId: photo.id });
  const rematching = context.faces.rematch({ ownerId: OWNER });
  await held.entered;
  try {
    await context.faces.saveThreshold({ ownerId: OWNER, threshold: HIGH_THRESHOLD, rematch: true });
  } finally {
    held.release();
    await rematching;
  }
  expect(
    (await context.assets.detail({ ownerId: OWNER, readableId: photo.readableId }))!.depicts,
  ).toEqual([]);
});

test('a failed replacement portrait removes automatic links immediately while preserving confirmed faces', async () => {
  await using context = await fixture();
  const person = await context.person();
  const portrait = await context.upload('Original portrait');
  await context.assignPortrait({
    personReadableId: person.readableId,
    assetReadableId: portrait.readableId,
  });
  context.analyzer.next = [detectedFace(), { ...detectedFace(), box: SECOND_BOX }];
  const photo = await context.upload('Two views of the same person');
  const input = { ownerId: OWNER, readableId: photo.readableId };
  const faces = (await context.faces.detail(input))!.faces;
  expect((await context.assets.detail(input))!.depicts).toHaveLength(1);
  await context.faces.annotate({
    ...input,
    faceReadableId: faces[0]!.readableId,
    decision: 'person',
    entityReadableId: person.readableId,
  });
  context.analyzer.failure = new Error('Replacement cannot be analyzed');
  const replacement = await context.upload('Failed replacement');
  await context.entities.setImage({
    ownerId: OWNER,
    readableId: person.readableId,
    assetReadableId: replacement.readableId,
  });
  expect(await context.reference(person)).toBeNull();
  await context.repository.matchAsset({
    ownerId: OWNER,
    assetId: photo.id,
    model: context.analyzer.model,
  });
  const result = (await context.faces.detail(input))!;
  expect(result.faces[0]).toMatchObject({
    decision: 'person',
    entity: { readableId: person.readableId },
  });
  expect(result.faces[1]!.entity).toBeNull();
  expect((await context.assets.detail(input))!.depicts).toMatchObject([
    { source: 'confirmed', entity: { readableId: person.readableId } },
  ]);
  expect(
    await context.database<
      Array<{ source: string }>
    >`select "source" from "asset_depicts_entity" where "owner_id" = ${OWNER} and "asset_id" = ${photo.id}`,
  ).toEqual([{ source: 'confirmed' }]);
  await context.entities.removeImage({ ownerId: OWNER, readableId: person.readableId });
  expect((await context.assets.detail(input))!.depicts).toHaveLength(1);
  await context.faces.annotate({
    ...input,
    faceReadableId: faces[0]!.readableId,
    decision: 'dismissed',
  });
  expect((await context.assets.detail(input))!.depicts).toEqual([]);
});

test('person type changes and resource archives hide stored links without erasing manual decisions', async () => {
  await using context = await fixture();
  const person = await context.person();
  const portrait = await context.upload('Portrait');
  await context.assignPortrait({
    personReadableId: person.readableId,
    assetReadableId: portrait.readableId,
  });
  const photo = await context.upload('Confirmed photo');
  const input = { ownerId: OWNER, readableId: photo.readableId };
  const face = (await context.faces.detail(input))!.faces[0]!;
  await context.faces.annotate({
    ...input,
    faceReadableId: face.readableId,
    decision: 'person',
    entityReadableId: person.readableId,
  });
  await context.entities.update({
    ownerId: OWNER,
    readableId: person.readableId,
    name: person.name,
    description: person.description,
    entityType: 'organization',
  });
  expect((await context.assets.detail(input))!.depicts).toEqual([]);
  expect((await context.faces.detail(input))!.faces[0]).toMatchObject({
    decision: 'person',
    entity: null,
  });
  expect(
    (await context.faces.images({
      ownerId: OWNER,
      entityReadableId: person.readableId,
      offset: 0,
    }))!.items,
  ).toEqual([]);
  await context.entities.update({
    ownerId: OWNER,
    readableId: person.readableId,
    name: person.name,
    description: person.description,
    entityType: 'person',
  });
  expect((await context.assets.detail(input))!.depicts).toMatchObject([
    { source: 'confirmed', entity: { readableId: person.readableId } },
  ]);
  expect(await context.assets.archive(input)).toMatchObject({ state: 'archived' });
  expect(
    (await context.faces.images({
      ownerId: OWNER,
      entityReadableId: person.readableId,
      offset: 0,
    }))!.items.map((asset) => asset.readableId),
  ).not.toContain(photo.readableId);
  expect(
    await context.entities.archive({ ownerId: OWNER, readableId: person.readableId }),
  ).toMatchObject({ state: 'archived' });
  expect(
    (await context.assets.detail({ ownerId: OWNER, readableId: portrait.readableId }))!.depicts,
  ).toEqual([]);
});

test('face and portrait mutations roll back together with their link changes', async () => {
  await using context = await fixture();
  const person = await context.person();
  const portrait = await context.upload('Portrait');
  await context.assignPortrait({
    personReadableId: person.readableId,
    assetReadableId: portrait.readableId,
  });
  const photo = await context.upload('Photo');
  const input = { ownerId: OWNER, readableId: photo.readableId };
  const face = (await context.faces.detail(input))!.faces[0]!;
  await context.database.unsafe(
    `create trigger reject_link_change before delete on asset_depicts_entity begin select raise(abort, 'Test link failure'); end`,
  );
  await expect(
    context.faces.annotate({ ...input, faceReadableId: face.readableId, decision: 'unknown' }),
  ).rejects.toThrow('Test link failure');
  expect((await context.faces.detail(input))!.faces[0]).toMatchObject({
    decision: 'automatic',
    entity: { readableId: person.readableId },
  });
  await expect(
    context.entities.removeImage({ ownerId: OWNER, readableId: person.readableId }),
  ).rejects.toThrow('Test link failure');
  expect(
    (await context.entities.detail({ ownerId: OWNER, readableId: person.readableId }))!.image
      ?.readableId,
  ).toBe(portrait.readableId);
  expect(await context.reference(person)).not.toBeNull();
  expect((await context.assets.detail(input))!.depicts).toMatchObject([
    { source: 'detected', entity: { readableId: person.readableId } },
  ]);
});

test('face rows and stored links reject invalid decisions, embeddings, and cross-resource ownership', async () => {
  await using context = await fixture();
  const photo = await context.upload('Private photo');
  const secondPhoto = await context.upload('Another photo');
  const [face] = await context.repository.observations({ ownerId: OWNER, assetId: photo.id });
  const person = await context.person();
  const otherPerson = await context.entities.create({
    ownerId: OTHER_OWNER,
    name: 'Other owner person',
    description: 'A person belonging to another owner',
    entityType: 'person',
  });
  if (otherPerson.state !== 'created') {
    throw new Error('Expected other owner person');
  }
  await expect(
    (async () =>
      await context.database`update "asset_face" set "annotation_decision" = 'person' where "id" = ${face!.id}`)(),
  ).rejects.toThrow('CHECK');
  await expect(
    (async () =>
      await context.database`update "asset_face" set "embedding_dimensions" = 1 where "id" = ${face!.id}`)(),
  ).rejects.toThrow('CHECK');
  await expect(
    (async () =>
      await context.database`update "asset_face" set "annotation_decision" = 'person', "annotation_entity_id" = ${otherPerson.entity.id}, "annotation_updated_at" = 'now' where "id" = ${face!.id}`)(),
  ).rejects.toThrow('FOREIGN KEY');
  await expect(
    (async () =>
      await context.database`insert into "asset_depicts_entity" ("face_id", "owner_id", "asset_id", "entity_id", "source") values (${face!.id}, ${OWNER}, ${secondPhoto.id}, ${person.id}, 'confirmed')`)(),
  ).rejects.toThrow('FOREIGN KEY');
  await expect(
    (async () =>
      await context.database`insert into "asset_depicts_entity" ("face_id", "owner_id", "asset_id", "entity_id", "source") values (${face!.id}, ${OWNER}, ${photo.id}, ${otherPerson.entity.id}, 'confirmed')`)(),
  ).rejects.toThrow('FOREIGN KEY');
  expect(
    (await context.assets.detail({ ownerId: OWNER, readableId: photo.readableId }))!.depicts,
  ).toEqual([]);
});

async function waitForState({
  faces,
  readableId,
  state,
}: {
  faces: AssetFacesService;
  readableId: string;
  state: string;
}) {
  const deadline = Date.now() + ANALYSIS_TEST_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await faces.detail({ ownerId: OWNER, readableId }))?.state === state) {
      return;
    }
    await Bun.sleep(1);
  }
  throw new Error(`Image did not reach ${state}`);
}

test('busy uploads and repeated analysis requests drain without keeping the browser connected', async () => {
  await using context = await fixture();
  const release = Promise.withResolvers<void>();
  context.analyzer.wait = release.promise;
  const first = await context.assets.create({
    ownerId: OWNER,
    name: 'A running image',
    file: Bun.file(PHOTO_PATH),
  });
  const second = await context.assets.create({
    ownerId: OWNER,
    name: 'B waiting image',
    file: Bun.file(PHOTO_PATH),
  });
  if (first.state !== 'created' || second.state !== 'created') {
    throw new Error('Upload failed');
  }
  try {
    await waitForState({
      faces: context.faces,
      readableId: first.asset.readableId,
      state: 'processing',
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await context.request({
        path: `/assets/${second.asset.readableId}/faces/analyze`,
        method: 'POST',
      });
      expect(response.status).toBe(StatusMap.OK);
      expect(await response.json()).toMatchObject({ state: 'queued' });
    }
    const queue = await context.request({ path: '/face-recognition/processing?filter=pending' });
    const body = await queue.json();
    expect(body.counts.queued).toBe(2);
    expect(body.items.map((item: { state: string }) => item.state)).toEqual([
      'processing',
      'queued',
    ]);
    expectNoInternalResourceIds(body);
    expect(
      (
        await context.request({
          path: `/assets/${second.asset.readableId}/faces/analyze`,
          method: 'POST',
          owner: OTHER_OWNER,
        })
      ).status,
    ).toBe(StatusMap['Not Found']);
  } finally {
    release.resolve();
  }
  await waitForState({ faces: context.faces, readableId: second.asset.readableId, state: 'ready' });
  expect(context.analyzer.calls).toBe(2);
});

test('the worker recovers saved and interrupted images after restart and skips archived assets', async () => {
  await using context = await fixture({ automatic: false });
  const saved = await context.assets.create({
    ownerId: OWNER,
    name: 'Saved before wake-up',
    file: Bun.file(PHOTO_PATH),
  });
  const interrupted = await context.upload('Interrupted image');
  const archived = await context.assets.create({
    ownerId: OWNER,
    name: 'Archived image',
    file: Bun.file(PHOTO_PATH),
  });
  if (saved.state !== 'created' || archived.state !== 'created') {
    throw new Error('Upload failed');
  }
  await context.assets.archive({ ownerId: OWNER, readableId: archived.asset.readableId });
  await context.repository.begin({
    ownerId: OWNER,
    assetId: interrupted.id,
    analysisVersion: context.analyzer.model.analysisVersion,
    contentHash: 'interrupted',
    attemptId: 'interrupted',
    updatedAt: new Date().toISOString(),
  });
  await context.faces.close();
  const restarted = new AssetFacesService(context.dependencies);
  try {
    restarted.startProcessing();
    await waitForState({ faces: restarted, readableId: saved.asset.readableId, state: 'ready' });
    await waitForState({ faces: restarted, readableId: interrupted.readableId, state: 'ready' });
    expect(context.analyzer.calls).toBe(THREE_ANALYSES);
  } finally {
    await restarted.close();
  }
});

test('failed images are visible, owner-scoped, and retried explicitly; zero faces is success', async () => {
  await using context = await fixture();
  context.analyzer.failure = new Error('bad image');
  const failed = await context.upload('Failed image');
  context.analyzer.failure = null;
  context.analyzer.next = [];
  await context.upload('Image without faces');
  const response = await context.request({
    path: '/face-recognition/processing?filter=failed&limit=1',
  });
  const body = await response.json();
  expect(body.counts).toMatchObject({ failed: 1, ready: 1 });
  expect(body.items).toHaveLength(1);
  expect(body.items[0]).toMatchObject({
    asset: { readableId: failed.readableId },
    state: 'failed',
    error: expect.any(String),
  });
  expect(
    (
      await (
        await context.request({ path: '/face-recognition/processing', owner: OTHER_OWNER })
      ).json()
    ).items,
  ).toEqual([]);
  for (const path of [
    '/face-recognition/processing',
    '/face-recognition/model/check',
    '/face-recognition/retry',
  ]) {
    expect(
      (
        await context.request({
          path,
          owner: null,
          method: path.endsWith('processing') ? 'GET' : 'POST',
        })
      ).status,
    ).toBe(StatusMap.Unauthorized);
  }
  await context.request({ path: '/face-recognition/retry', method: 'POST', owner: OTHER_OWNER });
  expect(
    (await context.faces.detail({ ownerId: OWNER, readableId: failed.readableId }))?.state,
  ).toBe('failed');
  await context.request({ path: '/face-recognition/retry', method: 'POST' });
  await waitForState({ faces: context.faces, readableId: failed.readableId, state: 'ready' });
  expect(context.analyzer.calls).toBe(THREE_ANALYSES);
});

test('images remain queued while the model is unavailable and resume after a successful model check', async () => {
  await using context = await fixture({ automatic: false });
  const attempted = Promise.withResolvers<void>();
  let available = false;
  context.analyzer.status = async () => ({
    state: available ? 'ready' : 'unavailable',
    downloaded: true,
    error: available ? null : 'Model unavailable',
    checkedAt: null,
  });
  context.analyzer.check = () => {
    attempted.resolve();
    return available ? Promise.resolve() : Promise.reject(new Error('Model unavailable'));
  };
  const saved = await context.assets.create({
    ownerId: OWNER,
    name: 'Waiting for model',
    file: Bun.file(PHOTO_PATH),
  });
  if (saved.state !== 'created') {
    throw new Error('Upload failed');
  }
  context.faces.startProcessing();
  await attempted.promise;
  const response = await context.request({ path: '/face-recognition/processing' });
  expect(await response.json()).toMatchObject({
    model: { state: 'unavailable', downloaded: true },
    counts: { queued: 1, failed: 0 },
    items: [{ state: 'queued', error: null }],
  });
  expect(context.analyzer.calls).toBe(0);
  available = true;
  const check = await context.request({ path: '/face-recognition/model/check', method: 'POST' });
  expect(check.status).toBe(StatusMap.OK);
  await waitForState({ faces: context.faces, readableId: saved.asset.readableId, state: 'ready' });
  expect(context.analyzer.calls).toBe(1);
});

test('a model check excludes direct analysis and keeps queued images pending until it completes', async () => {
  await using context = await fixture({ automatic: false });
  const saved = await context.assets.create({
    ownerId: OWNER,
    name: 'Waiting for exclusive engine access',
    file: Bun.file(PHOTO_PATH),
  });
  if (saved.state !== 'created') {
    throw new Error('Upload failed');
  }
  const checking = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  context.analyzer.check = async () => {
    checking.resolve();
    await release.promise;
  };
  const input = { ownerId: OWNER, readableId: saved.asset.readableId };
  try {
    await context.faces.checkModel();
    await checking.promise;
    context.faces.startProcessing();
    await expect(context.faces.process(input)).rejects.toThrow('busy');
    expect(context.analyzer.calls).toBe(0);
    expect(await context.faces.detail(input)).toMatchObject({ state: 'queued', error: null });
  } finally {
    release.resolve();
  }
  await waitForState({ faces: context.faces, readableId: saved.asset.readableId, state: 'ready' });
  expect(context.analyzer.calls).toBe(1);
});

test('model checks cannot acquire the engine after the face service closes', async () => {
  await using context = await fixture();
  let checks = 0;
  context.analyzer.check = () => {
    checks++;
    return Promise.resolve();
  };
  await context.faces.close();
  await context.faces.checkModel();
  expect(checks).toBe(0);
  expect(() => context.faces.startProcessing()).toThrow('cannot be restarted');
});

test.each(['no faces', 'failed analysis'] as const)(
  'assigned portraits appear without detection evidence: %s',
  async (scenario) => {
    await using context = await fixture();
    context.analyzer.next = [];
    context.analyzer.failure =
      scenario === 'failed analysis' ? new Error('Model unavailable') : null;
    const portrait = await context.upload('Assigned portrait');
    const person = await context.person();
    const selected = await context.request({
      path: `/entities/${person.readableId}/image`,
      method: 'PUT',
      body: { assetReadableId: portrait.readableId },
    });
    expect(selected.status).toBe(StatusMap.OK);
    const response = await context.request({ path: `/entities/${person.readableId}/images` });
    const body = await response.json();
    expect(body).toMatchObject({ items: [{ readableId: portrait.readableId }], nextOffset: null });
    expectNoInternalResourceIds(body);
    expect(await context.reference(person)).toBeNull();
    expect(
      (await context.assets.detail({ ownerId: OWNER, readableId: portrait.readableId }))!.depicts,
    ).toEqual([]);
    const foreign = await context.request({
      path: `/entities/${person.readableId}/images`,
      owner: OTHER_OWNER,
    });
    expect(foreign.status).toBe(StatusMap['Not Found']);
  },
);

test('assigned portraits appear immediately while analysis is still running', async () => {
  await using context = await fixture();
  const release = Promise.withResolvers<void>();
  context.analyzer.wait = release.promise;
  try {
    const portrait = await context.assets.create({
      ownerId: OWNER,
      name: 'Pending portrait',
      file: Bun.file(PHOTO_PATH),
    });
    if (portrait.state !== 'created') {
      throw new Error('Upload failed');
    }
    const person = await context.person();
    expect(
      await context.entities.setImage({
        ownerId: OWNER,
        readableId: person.readableId,
        assetReadableId: portrait.asset.readableId,
      }),
    ).toMatchObject({ state: 'updated' });
    const response = await context.request({ path: `/entities/${person.readableId}/images` });
    expect(await response.json()).toMatchObject({
      items: [{ readableId: portrait.asset.readableId }],
      nextOffset: null,
    });
    expect(await context.reference(person)).toBeNull();
  } finally {
    release.resolve();
  }
});

test('portrait-only appearances follow replacement, removal, and person archiving', async () => {
  await using context = await fixture();
  context.analyzer.next = [];
  const first = await context.upload('First portrait');
  const second = await context.upload('Replacement portrait');
  const person = await context.person();
  const input = { ownerId: OWNER, readableId: person.readableId };
  const images = () =>
    context.faces.images({ ownerId: OWNER, entityReadableId: person.readableId, offset: 0 });
  await context.entities.setImage({ ...input, assetReadableId: first.readableId });
  expect((await images())!.items.map((asset) => asset.readableId)).toEqual([first.readableId]);
  await context.entities.setImage({ ...input, assetReadableId: second.readableId });
  expect((await images())!.items.map((asset) => asset.readableId)).toEqual([second.readableId]);
  await context.entities.removeImage(input);
  expect((await images())!.items).toEqual([]);
  await context.entities.setImage({ ...input, assetReadableId: second.readableId });
  expect(
    await context.assets.archive({ ownerId: OWNER, readableId: second.readableId }),
  ).toMatchObject({ state: 'resource_in_use' });
  await context.entities.archive(input);
  expect(await images()).toBeNull();
  expect(
    await context.assets.archive({ ownerId: OWNER, readableId: second.readableId }),
  ).toMatchObject({ state: 'archived' });
});
