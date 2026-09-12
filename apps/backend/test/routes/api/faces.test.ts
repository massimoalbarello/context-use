import { expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { StatusMap } from 'elysia';
import { createApp } from '#app.ts';
import { createSqliteDatabase, createSynchronousSqliteDatabase } from '#db/client.ts';
import { runMigrations } from '#db/migrate.ts';
import type { Auth } from '#lib/auth/better-auth.ts';
import type { AnalyzedFace, FaceAnalyzer } from '#lib/face-analysis/analyzer.ts';
import { LocalStorage } from '#lib/storage/local-storage.ts';
import type { Asset } from '#models/assets/model.ts';
import type { Entity } from '#models/entities/model.ts';
import { matchFace } from '#models/faces/matching.ts';
import type { FaceModel } from '#models/faces/model.ts';
import { AssetsRepository } from '#repositories/assets/repository.ts';
import { EntitiesRepository } from '#repositories/entities/repository.ts';
import { FacesRepository } from '#repositories/faces/repository.ts';
import { HealthRepository } from '#repositories/health/repository.ts';
import { HypermediaRepository } from '#repositories/hypermedia/repository.ts';
import { KnowledgePagesRepository } from '#repositories/knowledge-pages/repository.ts';
import { KnowledgeProfilesRepository } from '#repositories/knowledge-profiles/repository.ts';
import { OwnerRegistrationRepository } from '#repositories/owner-registration/repository.ts';
import { AssetFacesService } from '#services/assets/faces.ts';
import { AssetsService } from '#services/assets/service.ts';
import { EntitiesService } from '#services/entities/service.ts';
import { HealthService } from '#services/health/service.ts';
import { HypermediaService } from '#services/hypermedia/service.ts';
import { KnowledgePagesService } from '#services/knowledge-pages/service.ts';
import { KnowledgeProfilesService } from '#services/knowledge-profiles/service.ts';
import { OwnerRegistrationService } from '#services/owner-registration/service.ts';
import { unusedRecordSyncsService, unusedRecordsService } from '../../support/app.ts';
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
const PHOTO_PATH = resolve(
  import.meta.dir,
  '../../../../../scripts/seeds/isolated-development/assets/steve-jobs-2010.jpg',
);
const FACE_LEFT = 0.1;
const FACE_TOP = 0.1;
const FACE_WIDTH = 0.3;
const FACE_HEIGHT = 0.4;
const SECOND_FACE_LEFT = 0.6;
const EXAMPLE_BOX = [FACE_LEFT, FACE_TOP, FACE_WIDTH, FACE_HEIGHT] as const;
const SECOND_BOX = [SECOND_FACE_LEFT, FACE_TOP, FACE_WIDTH, FACE_HEIGHT] as const;
const SIMILAR_FACE_X = 0.8;
const SIMILAR_FACE_Y = 0.6;
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
  next = [detectedFace()];
  failure: Error | null = null;
  wait: Promise<void> | null = null;
  calls = 0;
  async analyze(): Promise<AnalyzedFace[]> {
    this.calls++;
    if (this.wait) {
      await this.wait;
    }
    if (this.failure) {
      throw this.failure;
    }
    return this.next;
  }
  close() {
    return Promise.resolve();
  }
}

async function fixture() {
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
    hypermediaService: new HypermediaService({ hypermedia: new HypermediaRepository(database) }),
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
    syncsService: unusedRecordSyncsService,
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

test('a new portrait matches earlier unknown faces and exposes links in both directions without crop assets', async () => {
  await using context = await fixture();
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
    state: 'failed',
    error: expect.stringContaining('interrupted'),
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
  await using context = await fixture();
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
    await context.faces.process(input);
    const reviewed = (await context.faces.detail(input))!.faces[0]!;
    expect(reviewed.decision).toBe(decision);
    expect(reviewed.entity?.readableId ?? null).toBe(otherPerson?.readableId ?? null);
    expect(await context.reference(person)).toBeNull();
  },
);

test('a match computed before a reference was re-embedded cannot be published afterward', async () => {
  await using context = await fixture();
  const person = await context.person();
  const portrait = await context.upload('Portrait');
  await context.assignPortrait({
    personReadableId: person.readableId,
    assetReadableId: portrait.readableId,
  });
  const photo = await context.upload('Photo');
  const references = await context.repository.references({
    ownerId: OWNER,
    embeddingSpace: context.analyzer.model.embeddingSpace,
  });
  const [face] = await context.repository.observations({ ownerId: OWNER, assetId: photo.id });
  const match = matchFace({
    face: face!,
    references,
    threshold: context.analyzer.model.defaultThreshold,
  });
  expect(match).not.toBeNull();
  context.analyzer.next = [detectedFace([0, 1])];
  await context.faces.process({ ownerId: OWNER, readableId: portrait.readableId });
  await context.repository.saveMatches({
    ownerId: OWNER,
    assetId: photo.id,
    embeddingSpace: context.analyzer.model.embeddingSpace,
    threshold: context.analyzer.model.defaultThreshold,
    matches: [match!],
  });
  expect(
    (await context.faces.detail({ ownerId: OWNER, readableId: photo.readableId }))!.faces[0]!
      .entity,
  ).toBeNull();
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
  expect(
    await context.repository.references({
      ownerId: OWNER,
      embeddingSpace: context.analyzer.model.embeddingSpace,
    }),
  ).toHaveLength(0);
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

test('matches computed before a threshold change cannot overwrite the newer re-match', async () => {
  await using context = await fixture();
  const person = await context.person();
  const portrait = await context.upload('Threshold reference');
  await context.assignPortrait({
    personReadableId: person.readableId,
    assetReadableId: portrait.readableId,
  });
  context.analyzer.next = [detectedFace([SIMILAR_FACE_X, SIMILAR_FACE_Y])];
  const photo = await context.upload('Threshold race');
  const references = await context.repository.references({
    ownerId: OWNER,
    embeddingSpace: context.analyzer.model.embeddingSpace,
  });
  const [face] = await context.repository.observations({ ownerId: OWNER, assetId: photo.id });
  const match = matchFace({
    face: face!,
    references,
    threshold: context.analyzer.model.defaultThreshold,
  });
  expect(match).not.toBeNull();
  await context.faces.saveThreshold({ ownerId: OWNER, threshold: HIGH_THRESHOLD, rematch: true });
  await context.repository.saveMatches({
    ownerId: OWNER,
    assetId: photo.id,
    embeddingSpace: context.analyzer.model.embeddingSpace,
    threshold: context.analyzer.model.defaultThreshold,
    matches: [match!],
  });
  expect(
    (await context.faces.detail({ ownerId: OWNER, readableId: photo.readableId }))!.faces[0]!
      .entity,
  ).toBeNull();
});
