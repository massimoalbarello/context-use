import {
  assertMarkdownObject,
  markdownObjectMetadata,
  type MarkdownObjectMetadata,
  type MarkdownObjectStore,
} from "@context-use/database";
import { BrokeredStorage } from "./storage-client.ts";

export class BrokeredMarkdownObjectStore implements MarkdownObjectStore {
  constructor(private readonly storage: BrokeredStorage) {}

  async write(revisionId: string, markdown: string): Promise<MarkdownObjectMetadata> {
    const metadata = markdownObjectMetadata(revisionId, markdown);
    await this.storage.writeDocument({
      revisionId,
      objectKey: metadata.body_object_key,
      sizeBytes: metadata.body_size_bytes,
      contentHash: metadata.body_content_hash,
      body: markdown,
    });
    return metadata;
  }

  async read(metadata: MarkdownObjectMetadata): Promise<string> {
    return assertMarkdownObject(await this.storage.readDocument(metadata.body_object_key), metadata);
  }
}
