import { isEmbeddableAsset } from '../../lib/asset-presentation';
import type { AssetSummary } from '../../queries/assets';
import type { EntitySummary } from '../../queries/entities';
import type { KnowledgePageSummary } from '../../queries/pages';
import type { ExternalRecordSummary } from '../../queries/records';

export type ActiveKnowledgeLink = {
  start: number;
  end: number;
  query: string;
};

export type KnowledgeLinkTarget =
  | { kind: 'entity'; entity: Pick<EntitySummary, 'name' | 'readableId'> }
  | { kind: 'record'; record: Pick<ExternalRecordSummary, 'title' | 'readableId'> }
  | { kind: 'page'; page: Pick<KnowledgePageSummary, 'title' | 'readableId'> }
  | { kind: 'asset'; asset: Pick<AssetSummary, 'name' | 'readableId' | 'mediaType'> };

const LINK_QUERY_PATTERN = /^[\p{L}\p{N} _.'-]*$/u;
const MAX_LINK_QUERY_LENGTH = 80;

export function findActiveKnowledgeLink({
  markdown,
  cursor,
}: {
  markdown: string;
  cursor: number;
}): ActiveKnowledgeLink | null {
  const beforeCursor = markdown.slice(0, cursor);
  const start = beforeCursor.lastIndexOf('@');
  if (start === -1) {
    return null;
  }

  const precedingCharacter = markdown[start - 1];
  if (precedingCharacter && !/[\s([{]/.test(precedingCharacter)) {
    return null;
  }

  const query = beforeCursor.slice(start + 1);
  if (query.length > MAX_LINK_QUERY_LENGTH || !LINK_QUERY_PATTERN.test(query)) {
    return null;
  }

  return { start, end: cursor, query };
}

function escapeMarkdownLabel(label: string): string {
  return label.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]');
}

export function insertKnowledgeLink({
  markdown,
  link,
  target,
}: {
  markdown: string;
  link: ActiveKnowledgeLink;
  target: KnowledgeLinkTarget;
}): { markdown: string; cursor: number } {
  const resource =
    target.kind === 'entity'
      ? target.entity
      : target.kind === 'page'
        ? target.page
        : target.kind === 'record'
          ? target.record
          : target.asset;
  const label = 'title' in resource ? resource.title : resource.name;
  const readableId = resource.readableId;
  const address = `context-use://${target.kind}/${readableId}`;
  const embedPrefix = target.kind === 'asset' && isEmbeddableAsset(target.asset) ? '!' : '';
  const markdownLink = `${embedPrefix}[${escapeMarkdownLabel(label)}](${address})`;
  const separator = /\s/.test(markdown[link.end] ?? '') ? '' : ' ';
  const nextMarkdown = `${markdown.slice(0, link.start)}${markdownLink}${separator}${markdown.slice(link.end)}`;

  return {
    markdown: nextMarkdown,
    cursor: link.start + markdownLink.length + separator.length,
  };
}
