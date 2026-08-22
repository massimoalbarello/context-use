import { createHash } from "node:crypto";

// Connector-controlled Markdown can be much larger than an authored knowledge
// page (notably a long agent conversation) while still remaining one exact raw
// record. Page schemas keep their tighter authoring limit.
export const MAX_KNOWLEDGE_PAGE_BYTES = 4_000_000;
export const MAX_MARKDOWN_DOCUMENT_BYTES = 64 * 1024 * 1024;

export type MarkdownObjectMetadata = {
  body_object_key: string;
  body_size_bytes: number;
  body_content_hash: string;
};

export interface MarkdownObjectStore {
  write(revisionId: string, markdown: string): Promise<MarkdownObjectMetadata>;
  read(metadata: MarkdownObjectMetadata): Promise<string>;
}

export async function mapConcurrently<T, R>(
  values: T[],
  concurrency: number,
  transform: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error("Concurrency must be a positive integer");
  }
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await transform(values[index]!, index);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    () => worker(),
  ));
  return results;
}

export function markdownObjectMetadata(revisionId: string, markdown: string): MarkdownObjectMetadata {
  const bytes = Buffer.from(markdown, "utf8");
  return {
    body_object_key: `documents/private/${revisionId}.md`,
    body_size_bytes: bytes.byteLength,
    body_content_hash: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function assertMarkdownObject(markdown: string, metadata: MarkdownObjectMetadata): string {
  const actual = markdownObjectMetadata(
    metadata.body_object_key.slice("documents/private/".length, -".md".length),
    markdown,
  );
  if (actual.body_size_bytes !== Number(metadata.body_size_bytes)
      || actual.body_content_hash !== metadata.body_content_hash) {
    throw new Error("Knowledge document failed integrity verification");
  }
  return markdown;
}
