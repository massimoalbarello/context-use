import { fromMarkdown } from 'mdast-util-from-markdown';
import { readableMarkdownText } from '#models/markdown/text.ts';
import type { DeliveredRecord } from './delivery-contract.generated.ts';
import { recordParticipantNames } from './model.ts';

/** The sync owns the explicit title; Markdown headings remain part of the body. */
export function recordSearchText(record: Exclude<DeliveredRecord, { operation: 'deleted' }>) {
  const participantNames = recordParticipantNames(record);
  return {
    body: readableMarkdownText(fromMarkdown(record.content.body)),
    metadata: [record.provider, record.kind, ...participantNames].join(' '),
    participantNames,
  };
}
