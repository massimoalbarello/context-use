import { isValidElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { normalizeKnowledgeHeadingId } from '#backend/models/markdown/headings.ts';
import { publicDocument } from './document.tsx';

function headingText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(headingText).join('');
  }
  return isValidElement<{ children?: ReactNode }>(node) ? headingText(node.props.children) : '';
}

const headings: Components = Object.fromEntries(
  (['h2', 'h3', 'h4', 'h5', 'h6'] as const).map((Tag) => [
    Tag,
    ({ children }: { children?: ReactNode }) => (
      <Tag id={normalizeKnowledgeHeadingId(headingText(children))}>{children}</Tag>
    ),
  ]),
);

export function publicPageHtml({
  publicId,
  title,
  markdown,
  modifiedAt,
}: {
  publicId: string;
  title: string;
  markdown: string;
  modifiedAt: string;
}): string {
  return publicDocument({
    title,
    modifiedAt,
    markdownUrl: `/public/pages/${encodeURIComponent(publicId)}/markdown`,
    children: (
      <article>
        <ReactMarkdown skipHtml components={headings}>
          {markdown}
        </ReactMarkdown>
      </article>
    ),
  });
}
