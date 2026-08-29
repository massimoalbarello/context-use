import { Link } from '@tanstack/react-router';
import { isValidElement, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';

type InternalLink =
  | { kind: 'entity'; readableId: string }
  | { kind: 'page'; readableId: string; fragment: string | undefined };

function internalLink(href: string): InternalLink | null {
  const match =
    /^context-use:\/\/(entity|page)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:#([a-z0-9]+(?:-[a-z0-9]+)*))?$/.exec(
      href,
    );
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return match[1] === 'entity'
    ? { kind: 'entity', readableId: match[2] }
    : { kind: 'page', readableId: match[2], fragment: match[3] };
}

function textContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textContent).join('');
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textContent(node.props.children);
  }
  return '';
}

export function knowledgeHeadingId(children: ReactNode): string {
  return textContent(children)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-');
}

export function KnowledgePageMarkdown({ markdown }: { markdown: string }) {
  return (
    <article className="knowledge-markdown">
      <ReactMarkdown
        urlTransform={(url) => (url.startsWith('context-use://') ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href, children }) => {
            const target = href ? internalLink(href) : null;
            if (target?.kind === 'entity') {
              return (
                <Link to="/entities/$id" params={{ id: target.readableId }}>
                  {children}
                </Link>
              );
            }
            if (target?.kind === 'page') {
              return (
                <Link to="/pages/$id" params={{ id: target.readableId }} hash={target.fragment}>
                  {children}
                </Link>
              );
            }
            return <a href={href}>{children}</a>;
          },
          h2: ({ children }) => <h2 id={knowledgeHeadingId(children)}>{children}</h2>,
          h3: ({ children }) => <h3 id={knowledgeHeadingId(children)}>{children}</h3>,
          h4: ({ children }) => <h4 id={knowledgeHeadingId(children)}>{children}</h4>,
          h5: ({ children }) => <h5 id={knowledgeHeadingId(children)}>{children}</h5>,
          h6: ({ children }) => <h6 id={knowledgeHeadingId(children)}>{children}</h6>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
