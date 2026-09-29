import type { Storage } from '#backend/lib/storage/storage.ts';
import { readVerifiedBytes, readVerifiedText } from '#backend/lib/storage/verified-file.ts';
import { InvalidKnowledgePageMarkdownError } from '#backend/models/knowledge-pages/markdown.ts';
import {
  publicAssetMedia,
  publicPageMarkdown,
  publicRecordMarkdown,
} from '#backend/models/public-resources/markdown.ts';
import type {
  PagePublicationPreviewInput,
  PublicResourcesRepositoryContract,
  StoredPublicPage,
} from '#backend/repositories/public-resources/repository.ts';

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

  async homepageContent(input: { ownerId: string }) {
    const homepage = await this.resources.findHomepage(input);
    if (!homepage) {
      return null;
    }
    const content = await this.pageContent(homepage);
    return content ? { publicId: homepage.publicId, ...content } : null;
  }

  async pageContent(input: { publicId: string }) {
    return this.projectPage({ page: await this.resources.findPage(input) });
  }

  async pagePreview(input: PagePublicationPreviewInput) {
    // A first publication has no public handle yet; self-references stay within the preview.
    return this.projectPage({
      page: await this.resources.findPagePreview(input),
      localPageReadableId: input.readableId,
    });
  }

  private async projectPage({
    page,
    localPageReadableId,
  }: {
    page: StoredPublicPage | null;
    localPageReadableId?: string;
  }) {
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
      const markdown = publicPageMarkdown({
        markdown: source,
        targets: page.targets,
        localPageReadableId,
      });
      return markdown === null
        ? null
        : {
            title: page.title,
            markdown,
            modifiedAt: page.modifiedAt,
            assetMedia: publicAssetMedia(page.targets),
            mentions: Object.fromEntries(
              page.mentions.map((entity) => [
                `/public/entities/${encodeURIComponent(entity.publicId)}`,
                {
                  name: entity.name,
                  imageUrl: entity.imagePublicId
                    ? `/public/assets/${encodeURIComponent(entity.imagePublicId)}`
                    : null,
                },
              ]),
            ),
          };
    } catch (error) {
      if (error instanceof InvalidKnowledgePageMarkdownError) {
        return null;
      }
      throw error;
    }
  }

  index(input: { offset: number; limit: number }) {
    return this.resources.list(input);
  }

  async recordContent(input: { publicId: string }) {
    const record = await this.resources.findRecord(input);
    if (!record) {
      return null;
    }
    const source = await readVerifiedText({
      storage: this.storage,
      storageKey: record.storageKey,
      contentHash: record.contentHash,
      sizeBytes: record.sizeBytes,
      label: 'Public record',
    });
    const markdown = publicRecordMarkdown({ markdown: source, targets: record.targets });
    return markdown === null
      ? null
      : { title: record.title, markdown, assetMedia: publicAssetMedia(record.targets) };
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
  | 'pagePreview'
  | 'homepageContent'
  | 'assetContent'
  | 'pageContent'
  | 'entityContent'
  | 'recordContent'
  | 'index'
>;
