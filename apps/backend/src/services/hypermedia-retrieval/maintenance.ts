import type { StorageClient } from '#lib/storage/storage.ts';
import { readVerifiedText } from '#lib/storage/verified-text.ts';
import { parseKnowledgePageMarkdown } from '#models/knowledge-pages/markdown.ts';
import type { HypermediaRetrievalRepositoryContract } from '#repositories/hypermedia-retrieval/contract.ts';
import type { KnowledgePagesRepositoryContract } from '#repositories/knowledge-pages/repository.ts';
import type { RecordsRepositoryContract } from '#repositories/records/repository.ts';

type RebuildProgress = { resourceType: 'knowledge_page' | 'record'; readableId: string };

/** Explicit maintenance, separate from the read-only query workflow and from startup. */
export class HypermediaSearchMaintenanceService {
  constructor(
    private readonly dependencies: {
      pages: Pick<KnowledgePagesRepositoryContract, 'listCurrent' | 'replaceCurrentIndex'>;
      storage: StorageClient;
      records: Pick<RecordsRepositoryContract, 'rebuildSearchBatch'>;
      retrieval: Pick<HypermediaRetrievalRepositoryContract, 'rebuildIndex' | 'verifyIndex'>;
    },
  ) {}

  async rebuild({
    ownerId,
    afterPage,
    afterRecord,
    onProgress,
  }: {
    ownerId: string;
    afterPage?: string;
    afterRecord?: string;
    onProgress?: (progress: RebuildProgress) => void;
  }): Promise<void> {
    await this.dependencies.retrieval.rebuildIndex({ ownerId });
    const pageBatchSize = 25;
    let afterReadableId = afterPage ?? null;
    while (true) {
      const pages = await this.dependencies.pages.listCurrent({
        ownerId,
        afterReadableId,
        limit: pageBatchSize,
      });
      if (pages.length === 0) {
        break;
      }
      for (const page of pages) {
        const markdown = await readVerifiedText({
          storage: this.dependencies.storage,
          key: page.storageKey,
          contentHash: page.contentHash,
        });
        const parsed = parseKnowledgePageMarkdown(markdown);
        const result = await this.dependencies.pages.replaceCurrentIndex({
          ownerId,
          readableId: page.readableId,
          expectedRevisionId: page.currentRevisionId,
          title: parsed.title,
          excerpt: parsed.excerpt,
          searchableText: parsed.searchableText,
          links: parsed.links,
        });
        if (result.state === 'link_target_not_found') {
          throw new Error(`Cannot rebuild knowledge links: missing ${result.target}`);
        }
        // A concurrent revision/archival owns its own projection transaction; never overwrite it.
        afterReadableId = page.readableId;
        onProgress?.({ resourceType: 'knowledge_page', readableId: afterReadableId });
      }
    }
    let after = afterRecord ?? null;
    while (true) {
      after = await this.dependencies.records.rebuildSearchBatch({
        ownerId,
        afterReadableId: after,
      });
      if (after === null) {
        break;
      }
      onProgress?.({ resourceType: 'record', readableId: after });
    }
    await this.dependencies.retrieval.verifyIndex({ ownerId });
  }
}
