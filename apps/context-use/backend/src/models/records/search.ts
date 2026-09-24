import { fromMarkdown } from 'mdast-util-from-markdown';
import { readableMarkdownText } from '#backend/models/markdown/text.ts';
import type { NativeRecord } from './model.ts';

export function recordSearchText(record: {
  body: string;
  source: Pick<NativeRecord['source'], 'provider' | 'kind'>;
}) {
  return {
    body: readableMarkdownText(fromMarkdown(record.body)),
    metadata: [record.source.provider, record.source.kind].join(' '),
  };
}
