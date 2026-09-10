import { fromMarkdown } from 'mdast-util-from-markdown';
import { readableMarkdownText } from '#models/markdown/text.ts';
import type { RecordMetadata } from '#models/records/model.ts';

export function recordSearchText({
  markdown,
  kind,
  recordId,
  metadata,
}: {
  markdown: string;
  kind: string;
  recordId: string;
  metadata: RecordMetadata | null;
}): { title: string; body: string; metadata: string } {
  // Imported records are evidence, not curated pages: no required H1 or relationship validation.
  const tree = fromMarkdown(markdown);
  const heading = tree.children[0];
  const title =
    heading?.type === 'heading' && heading.depth === 1
      ? readableMarkdownText({ type: 'root', children: tree.children.splice(0, 1) })
      : '';
  const participants =
    metadata?.participants?.flatMap(({ name, roles, identities }) => [
      name,
      ...roles,
      ...identities.map(({ id }) => id),
    ]) ?? [];
  // Provider-defined structures have no shared semantics yet. Index textual attributes and tags,
  // not serialized JSON, nested objects, booleans, delivery IDs, hashes or receipt timestamps.
  const attributes = Object.values(metadata?.attributes ?? {}).flatMap((value) =>
    typeof value === 'string'
      ? [value]
      : Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [],
  );
  return {
    title,
    body: readableMarkdownText(tree),
    metadata: [kind, recordId, metadata?.provider, ...participants, ...attributes]
      .filter(Boolean)
      .join(' '),
  };
}
