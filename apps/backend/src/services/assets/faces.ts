import { FaceAnalysisError, type FaceAnalyzer } from '#lib/face-analysis/analyzer.ts';
import { createLogger } from '#lib/logger.ts';
import type { Storage } from '#lib/storage/storage.ts';
import type { StoredAsset } from '#models/assets/model.ts';
import { matchFace } from '#models/faces/matching.ts';
import type { AssetFaces, FaceDecision, FaceObservation } from '#models/faces/model.ts';
import type { AssetsRepositoryContract } from '#repositories/assets/repository.ts';
import type { EntityRepositoryContract } from '#repositories/entities/repository.ts';
import type { AnalysisAttempt, FacesRepositoryContract } from '#repositories/faces/contract.ts';

const ANALYSIS_TIMEOUT_MS = 90_000;
const REMATCH_BATCH_SIZE = 50;
const DEFAULT_IMAGE_LIMIT = 30;
const logger = createLogger('face-analysis');

type AssetInput = { ownerId: string; readableId: string };

export class AssetFacesService {
  private readonly repository: FacesRepositoryContract;
  private readonly assets: AssetsRepositoryContract;
  private readonly entities: EntityRepositoryContract;
  private readonly storage: Storage;
  private readonly crops: Storage;
  private readonly analyzer: FaceAnalyzer;
  private activeAsset: string | null = null;
  private readonly stopping = new AbortController();
  private readonly operations = new Set<Promise<unknown>>();

  constructor(input: {
    repository: FacesRepositoryContract;
    assets: AssetsRepositoryContract;
    entities: EntityRepositoryContract;
    storage: Storage;
    crops: Storage;
    analyzer: FaceAnalyzer;
  }) {
    this.repository = input.repository;
    this.assets = input.assets;
    this.entities = input.entities;
    this.storage = input.storage;
    this.crops = input.crops;
    this.analyzer = input.analyzer;
  }

  async detail(input: AssetInput): Promise<AssetFaces | null> {
    const asset = await this.assets.find(input);
    if (!asset) {
      return null;
    }
    const result = await this.repository.detail({
      ownerId: input.ownerId,
      assetId: asset.id,
      analysisVersion: this.analyzer.model.analysisVersion,
    });
    const interrupted = result.state === 'processing' && this.activeAsset !== asset.id;
    return {
      state: !this.supports(asset)
        ? 'unsupported'
        : this.activeAsset === asset.id
          ? 'processing'
          : interrupted
            ? 'failed'
            : result.state,
      error: interrupted ? 'Analysis was interrupted. Retry this image.' : result.error,
      outdated:
        result.analysisVersion !== null &&
        result.analysisVersion !== this.analyzer.model.analysisVersion,
      faces: result.faces,
    };
  }

  process(input: AssetInput): Promise<AssetFaces | null> {
    return this.track(this.processNow(input));
  }

  private async processNow(input: AssetInput): Promise<AssetFaces | null> {
    const asset = await this.assets.find(input);
    if (!asset || !this.supports(asset) || this.activeAsset || this.stopping.signal.aborted) {
      return this.detail(input);
    }
    this.activeAsset = asset.id;
    const model = this.analyzer.model;
    const attempt: AnalysisAttempt = {
      ownerId: input.ownerId,
      assetId: asset.id,
      contentHash: asset.contentHash,
      analysisVersion: model.analysisVersion,
      attemptId: Bun.randomUUIDv7(),
      updatedAt: new Date().toISOString(),
    };
    const created: string[] = [];
    let published = false;
    try {
      await this.repository.begin(attempt);
      const image = await this.verifiedImage(asset);
      const extracted = await this.analyzer.analyze({
        ownerId: input.ownerId,
        image,
        signal: AbortSignal.any([AbortSignal.timeout(ANALYSIS_TIMEOUT_MS), this.stopping.signal]),
      });
      const faces: FaceObservation[] = [];
      for (const face of extracted) {
        const id = Bun.randomUUIDv7();
        const cropKey = `${input.ownerId}/${asset.id}/${id}.jpg`;
        created.push(cropKey);
        await this.crops.write(cropKey, face.crop);
        faces.push({
          id,
          readableId: `face-${Bun.randomUUIDv7()}`,
          assetId: asset.id,
          box: face.box,
          detectionScore: face.detectionScore,
          cropKey,
          current: true,
          needsReview: false,
          embedding: face.embedding,
          embeddingRevision: id,
          embeddingSpace: model.embeddingSpace,
          analysisVersion: model.analysisVersion,
        });
      }
      const obsoleteCrops = await this.repository.complete({
        ...attempt,
        updatedAt: new Date().toISOString(),
        faces,
      });
      published = true;
      await this.removeCrops(obsoleteCrops);
      await this.matchAsset({ ownerId: input.ownerId, assetId: asset.id });
      const detail = await this.assets.detail(input);
      for (const usage of detail?.usages ?? []) {
        if (usage.kind === 'entity_image' && usage.entity.entityType === 'person') {
          await this.enrollAnalyzedPortrait({
            ownerId: input.ownerId,
            entityId: usage.entity.id,
            assetId: asset.id,
          });
        }
      }
    } catch (error) {
      if (!published) {
        await this.removeCrops(created);
      }
      const message =
        error instanceof FaceAnalysisError
          ? error.message
          : 'Face analysis failed. Retry this image.';
      await this.repository.fail({
        ...attempt,
        error: message,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      this.activeAsset = null;
    }
    return this.detail(input);
  }

  /** Saving returns immediately. Busy images stay unprocessed; there is no deferred queue. */
  processSavedAsset(input: AssetInput): Promise<void> {
    void this.process(input).catch(() => {
      logger.error('Could not record image analysis; the saved asset can be retried.');
    });
    return Promise.resolve();
  }

  preparePortrait(input: AssetInput): Promise<void> {
    return this.track(this.preparePortraitNow(input));
  }

  private async track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation);
    try {
      return await operation;
    } finally {
      this.operations.delete(operation);
    }
  }

  async close(): Promise<void> {
    this.stopping.abort();
    await Promise.allSettled(this.operations);
    await this.analyzer.close();
  }

  private async preparePortraitNow(input: AssetInput): Promise<void> {
    try {
      const entity = await this.entities.find(input);
      if (entity?.entityType !== 'person' || !entity.image) {
        return;
      }
      const assetInput = { ownerId: input.ownerId, readableId: entity.image.readableId };
      const current = await this.detail(assetInput);
      if (current?.state !== 'ready' || current.outdated) {
        await this.processSavedAsset(assetInput);
        return;
      }
      await this.enrollAnalyzedPortrait({
        ownerId: input.ownerId,
        entityId: entity.id,
        assetId: entity.image.id,
      });
    } catch {
      logger.error('Could not prepare the portrait reference; the selected image is saved.');
    }
  }

  private async enrollAnalyzedPortrait(input: {
    ownerId: string;
    entityId: string;
    assetId: string;
  }): Promise<void> {
    const existing = await this.repository.referenceFace(input);
    if (existing) {
      await this.rematch({ ownerId: input.ownerId });
      return;
    }
    const faces = await this.repository.observations(input);
    const candidates = faces.filter(
      (face) =>
        face.current &&
        !face.needsReview &&
        !face.protected &&
        face.analysisVersion === this.analyzer.model.analysisVersion,
    );
    if (candidates.length !== 1) {
      return;
    }
    const selected = await this.repository.selectReference({
      ...input,
      faceReadableId: candidates[0]!.readableId,
      updatedAt: new Date().toISOString(),
    });
    if (selected) {
      await this.rematch({ ownerId: input.ownerId });
    }
  }

  async portrait(input: AssetInput) {
    const entity = await this.entities.find(input);
    if (!entity) {
      return null;
    }
    return {
      image: entity.image,
      referenceFaceReadableId: await this.repository.referenceFace({
        ownerId: input.ownerId,
        entityId: entity.id,
      }),
      analysis: entity.image
        ? await this.detail({ ownerId: input.ownerId, readableId: entity.image.readableId })
        : null,
    };
  }

  async selectReference(input: AssetInput & { faceReadableId: string }): Promise<boolean> {
    const entity = await this.entities.find(input);
    if (!entity?.image || entity.entityType !== 'person') {
      return false;
    }
    const selected = await this.repository.selectReference({
      ownerId: input.ownerId,
      entityId: entity.id,
      assetId: entity.image.id,
      faceReadableId: input.faceReadableId,
      updatedAt: new Date().toISOString(),
    });
    if (selected) {
      await this.rematch({ ownerId: input.ownerId });
    }
    return selected;
  }

  async annotate(
    input: AssetInput & {
      faceReadableId: string;
      decision: FaceDecision;
      entityReadableId?: string;
    },
  ): Promise<boolean> {
    const asset = await this.assets.find(input);
    if (!asset) {
      return false;
    }
    const entity =
      input.decision === 'person' && input.entityReadableId
        ? await this.entities.find({ ownerId: input.ownerId, readableId: input.entityReadableId })
        : null;
    if (input.decision === 'person' && entity?.entityType !== 'person') {
      return false;
    }
    const updated = await this.repository.annotate({
      ownerId: input.ownerId,
      assetId: asset.id,
      faceReadableId: input.faceReadableId,
      updatedAt: new Date().toISOString(),
      annotation:
        input.decision === 'automatic'
          ? null
          : { decision: input.decision, entityId: entity?.id ?? null },
    });
    if (updated && input.decision === 'automatic') {
      await this.matchAsset({ ownerId: input.ownerId, assetId: asset.id });
    }
    return updated;
  }

  async crop(input: AssetInput & { faceReadableId: string }): Promise<Blob | null> {
    const asset = await this.assets.find(input);
    if (!asset) {
      return null;
    }
    const faces = await this.repository.observations({ ownerId: input.ownerId, assetId: asset.id });
    const face = faces.find(
      (face) => face.readableId === input.faceReadableId && (face.current || face.protected),
    );
    return face && (await this.crops.exists(face.cropKey)) ? this.crops.file(face.cropKey) : null;
  }

  async settings(input: { ownerId: string }) {
    return {
      model: this.analyzer.model,
      threshold: await this.repository.threshold({ ...input, model: this.analyzer.model }),
    };
  }

  async saveThreshold(input: {
    ownerId: string;
    threshold: number;
    rematch: boolean;
  }): Promise<void> {
    if (!Number.isFinite(input.threshold) || input.threshold < -1 || input.threshold > 1) {
      throw new Error('Invalid face matching threshold');
    }
    await this.repository.setThreshold({
      ...input,
      embeddingSpace: this.analyzer.model.embeddingSpace,
    });
    if (input.rematch) {
      await this.rematch(input);
    }
  }

  async rematch(input: { ownerId: string }): Promise<void> {
    let after: string | null = null;
    for (;;) {
      const batch = await this.repository.assetBatch({
        ownerId: input.ownerId,
        after,
        limit: REMATCH_BATCH_SIZE,
      });
      if (!batch.length) {
        return;
      }
      for (const asset of batch) {
        await this.matchAsset({ ownerId: input.ownerId, assetId: asset.id });
      }
      after = batch.at(-1)!.readableId;
    }
  }

  async retryBatch(input: { ownerId: string; after: string | null }) {
    // One asset per request lets the browser show progress and stop; no work is queued after disconnect.
    const [asset] = await this.repository.assetBatch({ ...input, limit: 1 });
    if (!asset) {
      return { next: null };
    }
    const current = await this.detail({ ownerId: input.ownerId, readableId: asset.readableId });
    if (current?.state === 'not_processed' || current?.state === 'failed' || current?.outdated) {
      await this.process({ ownerId: input.ownerId, readableId: asset.readableId });
    }
    return { next: asset.readableId };
  }

  async images(input: {
    ownerId: string;
    entityReadableId: string;
    offset: number;
    limit?: number;
  }) {
    const entity = await this.entities.find({
      ownerId: input.ownerId,
      readableId: input.entityReadableId,
    });
    if (!entity) {
      return null;
    }
    const limit = input.limit ?? DEFAULT_IMAGE_LIMIT;
    const images = await this.repository.images({ ...input, limit: limit + 1 });
    return {
      items: images.slice(0, limit),
      nextOffset: images.length > limit ? input.offset + limit : null,
    };
  }

  private async matchAsset(input: { ownerId: string; assetId: string }) {
    const threshold = await this.repository.threshold({
      ownerId: input.ownerId,
      model: this.analyzer.model,
    });
    const references = await this.repository.references({
      ownerId: input.ownerId,
      embeddingSpace: this.analyzer.model.embeddingSpace,
    });
    const observations = await this.repository.observations(input);
    const matches = observations
      .filter((face) => face.current && !face.protected)
      .flatMap((face) => {
        const match = matchFace({ face, references, threshold });
        return match ? [match] : [];
      });
    await this.repository.saveMatches({
      ...input,
      matches,
      threshold,
      embeddingSpace: this.analyzer.model.embeddingSpace,
    });
  }

  private supports(asset: Pick<StoredAsset, 'mediaType'>) {
    return this.analyzer.model.supportedMediaTypes.includes(asset.mediaType);
  }

  private async verifiedImage(asset: StoredAsset): Promise<Blob> {
    const file = this.storage.file(asset.storageKey);
    const hash = new Bun.CryptoHasher('sha256');
    let size = 0;
    for await (const chunk of file.stream()) {
      size += chunk.byteLength;
      hash.update(chunk);
    }
    if (size !== asset.sizeBytes || hash.digest('hex') !== asset.contentHash) {
      throw new FaceAnalysisError('Image content failed its integrity check.');
    }
    return file;
  }

  private async removeCrops(keys: string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.crops.delete(key);
      } catch {
        logger.warn('Could not remove an obsolete face crop.');
      }
    }
  }
}

export type AssetFacesServiceContract = Pick<
  AssetFacesService,
  | 'detail'
  | 'process'
  | 'processSavedAsset'
  | 'preparePortrait'
  | 'portrait'
  | 'selectReference'
  | 'annotate'
  | 'crop'
  | 'settings'
  | 'saveThreshold'
  | 'retryBatch'
  | 'images'
>;
