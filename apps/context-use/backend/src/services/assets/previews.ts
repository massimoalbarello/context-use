import { createLogger } from '#backend/lib/logger.ts';
import type { MediaPreviewProcessor } from '#backend/lib/media-preview/processor.ts';
import type { Storage } from '#backend/lib/storage/storage.ts';
import { readStoredFile } from '#backend/lib/storage/stored-file.ts';
import type { StoredAssetPreview } from '#backend/models/assets/preview.ts';
import type { AssetPreviewsRepositoryContract } from '#backend/repositories/asset-previews/repository.ts';
import { AssetProcessingWorker } from './processing-worker.ts';

const logger = createLogger('asset-previews');

export class AssetPreviewsService {
  private readonly stopping = new AbortController();
  private readonly worker = new AssetProcessingWorker(() => this.runNext());

  constructor(
    private readonly dependencies: {
      repository: AssetPreviewsRepositoryContract;
      storage: Storage;
      processor: MediaPreviewProcessor;
    },
  ) {}

  start() {
    this.worker.start();
  }

  async close() {
    this.stopping.abort();
    await this.worker.close();
  }

  async runNext() {
    const { repository, storage, processor } = this.dependencies;
    await processor.prepare();
    const source = await repository.next();
    if (!source || this.stopping.signal.aborted) {
      return false;
    }
    let preview: StoredAssetPreview | undefined;
    try {
      const blob = await readStoredFile({
        storage,
        storageKey: source.storageKey,
        sizeBytes: source.sizeBytes,
        label: 'Media preview source',
      });
      const generated = await processor.generate({ blob, signal: this.stopping.signal });
      // A preview must save bandwidth. Small images keep their original representation.
      if (source.mediaType.startsWith('video/') || generated.blob.size < source.sizeBytes) {
        const storageKey = `${source.ownerId}/assets/${source.id}/preview.webp`;
        const bytes = await generated.blob.bytes();
        const sizeBytes = await storage.write(storageKey, generated.blob);
        if (sizeBytes !== generated.blob.size) {
          throw new Error('Media preview was not fully written.');
        }
        preview = {
          width: generated.width,
          height: generated.height,
          storageKey,
          sizeBytes,
          contentHash: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
        };
      }
    } catch {
      if (this.stopping.signal.aborted) {
        return false;
      }
      logger.warn(`Preview unavailable for asset ${source.id}; the original is preserved.`);
    }
    await repository.complete({ source, preview });
    return true;
  }
}
