import type { StorageClient } from '#lib/storage/storage.ts';
import {
  InvalidKnowledgePageMarkdownError,
  parseKnowledgePageMarkdown,
} from '#models/knowledge-pages/markdown.ts';
import type {
  KnowledgePage,
  KnowledgePageSummary,
  StoredKnowledgePage,
} from '#models/knowledge-pages/model.ts';
import { readableIdFrom } from '#models/readable-ids/model.ts';
import type { KnowledgePagesRepositoryContract } from '#repositories/knowledge-pages/repository.ts';

export type KnowledgePageMutationResult =
  | { state: 'saved'; page: KnowledgePage }
  | { state: 'invalid_markdown'; message: string }
  | { state: 'readable_id_required' }
  | { state: 'not_found' }
  | { state: 'readable_id_conflict'; readableId: string }
  | { state: 'revision_conflict'; currentRevisionNumber: number }
  | { state: 'link_target_not_found'; target: string };

function contentHash(markdown: string): string {
  return new Bun.CryptoHasher('sha256').update(markdown).digest('hex');
}

export class KnowledgePagesService {
  private readonly pages: KnowledgePagesRepositoryContract;
  private readonly storage: StorageClient;

  constructor({
    pages,
    storage,
  }: {
    pages: KnowledgePagesRepositoryContract;
    storage: StorageClient;
  }) {
    this.pages = pages;
    this.storage = storage;
  }

  async create(input: {
    ownerId: string;
    readableId?: string;
    markdown: string;
  }): Promise<KnowledgePageMutationResult> {
    const parsed = this.parse(input.markdown);
    if ('message' in parsed) {
      return parsed;
    }
    const readableId = input.readableId ?? readableIdFrom(parsed.title);
    if (!readableId) {
      return { state: 'readable_id_required' };
    }
    const pageId = Bun.randomUUIDv7();
    const revisionId = Bun.randomUUIDv7();
    const storageKey = this.storageKey({
      ownerId: input.ownerId,
      pageId,
      revisionId,
    });
    const sizeBytes = Buffer.byteLength(input.markdown, 'utf8');
    await this.storage.write(
      storageKey,
      new Blob([input.markdown], { type: 'text/markdown;charset=utf-8' }),
    );

    let result: Awaited<ReturnType<KnowledgePagesRepositoryContract['create']>>;
    try {
      result = await this.pages.create({
        pageId,
        revisionId,
        ownerId: input.ownerId,
        readableId,
        title: parsed.title,
        excerpt: parsed.excerpt,
        storageKey,
        contentHash: contentHash(input.markdown),
        sizeBytes,
        links: parsed.links,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      await this.storage.delete(storageKey);
      throw error;
    }
    if (result.state !== 'created') {
      await this.storage.delete(storageKey);
      return result.state === 'readable_id_conflict' ? { state: result.state, readableId } : result;
    }
    const page = await this.detail({ ownerId: input.ownerId, readableId });
    if (!page) {
      throw new Error('Created knowledge page could not be read');
    }
    return { state: 'saved', page };
  }

  list(input: { ownerId: string; limit: number; offset: number; query?: string }) {
    return this.pages.list(input);
  }

  async detail({
    ownerId,
    readableId,
  }: {
    ownerId: string;
    readableId: string;
  }): Promise<KnowledgePage | null> {
    const detail = await this.pages.detail({ ownerId, readableId });
    if (!detail) {
      return null;
    }
    const { page, ...links } = detail;
    return {
      ...this.summary(page),
      markdown: await this.readMarkdown(page),
      ...links,
    };
  }

  async update(input: {
    ownerId: string;
    readableId: string;
    expectedRevisionNumber: number;
    markdown: string;
  }): Promise<KnowledgePageMutationResult> {
    const parsed = this.parse(input.markdown);
    if ('message' in parsed) {
      return parsed;
    }
    const existing = await this.pages.find({
      ownerId: input.ownerId,
      readableId: input.readableId,
    });
    if (!existing) {
      return { state: 'not_found' };
    }
    const revisionId = Bun.randomUUIDv7();
    const storageKey = this.storageKey({
      ownerId: input.ownerId,
      pageId: existing.id,
      revisionId,
    });
    const sizeBytes = Buffer.byteLength(input.markdown, 'utf8');
    await this.storage.write(
      storageKey,
      new Blob([input.markdown], { type: 'text/markdown;charset=utf-8' }),
    );

    let result: Awaited<ReturnType<KnowledgePagesRepositoryContract['update']>>;
    try {
      result = await this.pages.update({
        revisionId,
        ownerId: input.ownerId,
        readableId: input.readableId,
        expectedRevisionNumber: input.expectedRevisionNumber,
        title: parsed.title,
        excerpt: parsed.excerpt,
        storageKey,
        contentHash: contentHash(input.markdown),
        sizeBytes,
        links: parsed.links,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      await this.storage.delete(storageKey);
      throw error;
    }
    if (result.state !== 'updated') {
      await this.storage.delete(storageKey);
      return result;
    }
    const page = await this.detail({ ownerId: input.ownerId, readableId: input.readableId });
    if (!page) {
      throw new Error('Updated knowledge page could not be read');
    }
    return { state: 'saved', page };
  }

  async rebuildIndex({ ownerId }: { ownerId: string }): Promise<void> {
    const pages = await this.pages.listCurrent({ ownerId });
    for (const page of pages) {
      const parsed = parseKnowledgePageMarkdown(await this.readMarkdown(page));
      const result = await this.pages.replaceCurrentIndex({
        ownerId,
        readableId: page.readableId,
        title: parsed.title,
        excerpt: parsed.excerpt,
        links: parsed.links,
      });
      if (result.state !== 'replaced') {
        throw new Error(`Cannot rebuild knowledge links: missing ${result.target}`);
      }
    }
  }

  private parse(
    markdown: string,
  ):
    | ReturnType<typeof parseKnowledgePageMarkdown>
    | { state: 'invalid_markdown'; message: string } {
    try {
      return parseKnowledgePageMarkdown(markdown);
    } catch (error) {
      if (error instanceof InvalidKnowledgePageMarkdownError) {
        return { state: 'invalid_markdown', message: error.message };
      }
      throw error;
    }
  }

  private async readMarkdown(page: StoredKnowledgePage): Promise<string> {
    if (!(await this.storage.exists(page.storageKey))) {
      throw new Error(`Knowledge page blob ${page.currentRevisionId} is missing`);
    }
    const markdown = await this.storage.file(page.storageKey).text();
    if (contentHash(markdown) !== page.contentHash) {
      throw new Error(`Knowledge page blob ${page.currentRevisionId} failed its integrity check`);
    }
    return markdown;
  }

  private storageKey({
    ownerId,
    pageId,
    revisionId,
  }: {
    ownerId: string;
    pageId: string;
    revisionId: string;
  }): string {
    return `${ownerId}/pages/${pageId}/revisions/${revisionId}.md`;
  }

  private summary(page: StoredKnowledgePage): KnowledgePageSummary {
    return {
      id: page.id,
      readableId: page.readableId,
      title: page.title,
      excerpt: page.excerpt,
      revisionNumber: page.revisionNumber,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
    };
  }
}

export type KnowledgePagesServiceContract = Pick<
  KnowledgePagesService,
  'create' | 'list' | 'detail' | 'update' | 'rebuildIndex'
>;
