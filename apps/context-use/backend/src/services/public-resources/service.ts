import type { Storage } from '#backend/lib/storage/storage.ts';
import { readVerifiedBytes, readVerifiedText } from '#backend/lib/storage/verified-file.ts';
import { InvalidKnowledgePageMarkdownError } from '#backend/models/knowledge-pages/markdown.ts';
import { publicPageMarkdown } from '#backend/models/public-resources/markdown.ts';
import type { PublicResourcesRepositoryContract } from '#backend/repositories/public-resources/repository.ts';

export class PublicResourcesService {
  private readonly resources: PublicResourcesRepositoryContract;
  private readonly storage: Storage;

  constructor({
    resources,
    storage,
  }: {
    resources: PublicResourcesRepositoryContract;
    storage: Storage;
  }) {
    this.resources = resources;
    this.storage = storage;
  }

  async pageContent(input: { publicId: string }) {
    const page = await this.resources.findPage(input);
    if (!page) {
      return null;
    }
    const source = await readVerifiedText({
      storage: this.storage,
      storageKey: page.storageKey,
      contentHash: page.contentHash,
      sizeBytes: page.sizeBytes,
      label: 'Public page',
    });
    try {
      const markdown = publicPageMarkdown({ markdown: source, targets: page.targets });
      return markdown === null
        ? null
        : { title: page.title, markdown, modifiedAt: page.modifiedAt };
    } catch (error) {
      if (error instanceof InvalidKnowledgePageMarkdownError) {
        return null;
      }
      throw error;
    }
  }

  entityContent(input: { publicId: string }) {
    return this.resources.findEntity(input);
  }

  async assetContent(input: { publicId: string }) {
    const asset = await this.resources.findAsset(input);
    if (!asset) {
      return null;
    }
    const bytes = await readVerifiedBytes({
      storage: this.storage,
      storageKey: asset.storageKey,
      contentHash: asset.contentHash,
      sizeBytes: asset.sizeBytes,
      label: 'Public asset',
    });
    return {
      asset: {
        name: asset.name,
        mediaType: asset.mediaType,
        extension: asset.extension,
        sizeBytes: asset.sizeBytes,
      },
      blob: new Blob([bytes], { type: asset.mediaType }),
    };
  }
}

export type PublicResourcesServiceContract = Pick<
  PublicResourcesService,
  'assetContent' | 'pageContent' | 'entityContent'
>;
