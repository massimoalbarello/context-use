import {
  markdownObjectMetadata,
  type MarkdownObjectMetadata,
  type MarkdownObjectStore,
} from "../src/index.ts";

export class MemoryMarkdownStore implements MarkdownObjectStore {
  readonly bodies = new Map<string, string>();

  async write(revisionId: string, markdown: string): Promise<MarkdownObjectMetadata> {
    const metadata = markdownObjectMetadata(revisionId, markdown);
    this.bodies.set(metadata.body_object_key, markdown);
    return metadata;
  }

  async read(metadata: MarkdownObjectMetadata): Promise<string> {
    // Database integration files share one disposable schema and some create
    // metadata-only authorization fixtures. Their bodies are irrelevant to
    // tests in other files, but global export snapshots can still encounter
    // them while the files run concurrently.
    return this.bodies.get(metadata.body_object_key) ?? "";
  }
}
