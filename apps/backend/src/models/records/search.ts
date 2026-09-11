import { fromMarkdown } from 'mdast-util-from-markdown';
import { readableMarkdownText } from '#models/markdown/text.ts';
import type { DeliveredRecord } from './delivery-contract.generated.ts';

/** The sync owns the explicit title; Markdown headings remain part of the body. */
export function recordSearchText(record: Exclude<DeliveredRecord, { operation: 'deleted' }>) {
  const participantNames = [
    ...new Set(
      record.content.participants?.flatMap(({ name }) => (name?.trim() ? [name.trim()] : [])) ?? [],
    ),
  ];
  return {
    body: readableMarkdownText(fromMarkdown(record.content.body)),
    metadata: [record.provider, record.kind, ...participantNames].join(' '),
    participantNames,
  };
}
