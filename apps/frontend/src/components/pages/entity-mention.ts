import type { EntitySummary } from '../../queries/entities';

export type ActiveEntityMention = {
  start: number;
  end: number;
  query: string;
};

const MENTION_QUERY_PATTERN = /^[\p{L}\p{N} _.'-]*$/u;
const MAX_MENTION_QUERY_LENGTH = 80;

export function findActiveEntityMention({
  markdown,
  cursor,
}: {
  markdown: string;
  cursor: number;
}): ActiveEntityMention | null {
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
  if (query.length > MAX_MENTION_QUERY_LENGTH || !MENTION_QUERY_PATTERN.test(query)) {
    return null;
  }

  return { start, end: cursor, query };
}

function escapeMarkdownLabel(label: string): string {
  return label.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]');
}

export function insertEntityMention({
  markdown,
  mention,
  entity,
}: {
  markdown: string;
  mention: ActiveEntityMention;
  entity: Pick<EntitySummary, 'name' | 'readableId'>;
}): { markdown: string; cursor: number } {
  const link = `[${escapeMarkdownLabel(entity.name)}](context-use://entity/${entity.readableId})`;
  const separator = /\s/.test(markdown[mention.end] ?? '') ? '' : ' ';
  const nextMarkdown = `${markdown.slice(0, mention.start)}${link}${separator}${markdown.slice(mention.end)}`;

  return {
    markdown: nextMarkdown,
    cursor: mention.start + link.length + separator.length,
  };
}
