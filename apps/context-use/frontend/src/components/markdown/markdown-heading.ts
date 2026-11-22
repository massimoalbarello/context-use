import { isValidElement, type ReactNode } from 'react';
import { normalizeKnowledgeHeadingId } from '#backend/models/markdown/headings.ts';

export function markdownTextContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(markdownTextContent).join('');
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return markdownTextContent(node.props.children);
  }
  return '';
}

export function headingId(children: ReactNode) {
  return normalizeKnowledgeHeadingId(markdownTextContent(children));
}
