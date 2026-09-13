import {
  FaceAnalysisError,
  type FaceAnalyzer,
  validateFaceAnalysis,
} from '#backend/lib/face-analysis/analyzer.ts';
import { createLogger } from '#backend/lib/logger.ts';
import type { Storage } from '#backend/lib/storage/storage.ts';
import type { StoredAsset } from '#backend/models/assets/model.ts';
import type { AssetFaces, FaceDecision, FaceObservation } from '#backend/models/faces/model.ts';
import type { AssetsRepositoryContract } from '#backend/repositories/assets/repository.ts';
import type { EntityRepositoryContract } from '#backend/repositories/entities/repository.ts';
import type {
  AnalysisAttempt,
  FacesRepositoryContract,
} from '#backend/repositories/faces/contract.ts';

const ANALYSIS_TIMEOUT_MS = 90_000;
const REMATCH_BATCH_SIZE = 50;
const DEFAULT_IMAGE_LIMIT = 30;
const logger = createLogger('face-analysis');

type AssetInput = { ownerId: string; readableId: string };

export class FaceProcessingBusyError extends Error {
  constructor() {
    super('Image processing is busy. Retry when the current image finishes.');
  }
}

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
    if (!asset || !this.supports(asset)) {
      return this.detail(input);
    }
    this.assertIdle();
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
      const result = await this.analyzer.analyze({
        ownerId: input.ownerId,
        image,
        signal: AbortSignal.any([AbortSignal.timeout(ANALYSIS_TIMEOUT_MS), this.stopping.signal]),
      });
      const extracted = validateFaceAnalysis({ result, model });
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
    void this.process(input).catch((error) => {
      if (!(error instanceof FaceProcessingBusyError)) {
        logger.error('Could not record image analysis; the saved asset can be retried.');
      }
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
    const selected = await this.repository.enrollPortrait({
      ...input,
      analysisVersion: this.analyzer.model.analysisVersion,
      updatedAt: new Date().toISOString(),
    });
    if (selected) {
      await this.rematch({ ownerId: input.ownerId });
    }
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
    if (updated && input.decision === 'person' && entity?.image?.id === asset.id) {
      await this.preparePortrait({ ownerId: input.ownerId, readableId: entity.readableId });
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
    const { analysisVersion, defaultThreshold } = this.analyzer.model;
    return {
      model: { analysisVersion, defaultThreshold },
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
    this.assertIdle();
    const [asset] = await this.repository.assetBatch({ ...input, limit: 1 });
    if (!asset) {
      return { next: null };
    }
    const current = await this.detail({ ownerId: input.ownerId, readableId: asset.readableId });
    if (current?.state === 'processing') {
      throw new FaceProcessingBusyError();
    }
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

  private matchAsset(input: { ownerId: string; assetId: string }) {
    return this.repository.matchAsset({ ...input, model: this.analyzer.model });
  }

  private assertIdle() {
    if (this.activeAsset || this.stopping.signal.aborted) {
      throw new FaceProcessingBusyError();
    }
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
    return new Blob([file], { type: asset.mediaType });
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
  | 'annotate'
  | 'crop'
  | 'settings'
  | 'saveThreshold'
  | 'retryBatch'
  | 'images'
>;
