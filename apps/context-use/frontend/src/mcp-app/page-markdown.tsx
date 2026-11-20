import type { Root } from 'mdast';
import { toString as markdownText } from 'mdast-util-to-string';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import { visit } from 'unist-util-visit';
import { normalizeKnowledgeHeadingId } from '#backend/models/markdown/headings.ts';
import { remarkTables } from '#backend/models/markdown/tables.ts';

function remarkHeadingIds() {
  return (tree: Root) => {
    visit(tree, 'heading', (node) => {
      node.data = {
        ...node.data,
        hProperties: {
          ...node.data?.hProperties,
          id: normalizeKnowledgeHeadingId(markdownText(node)),
        },
      };
    });
  };
}

export function PageMarkdown({
  markdown,
  onPage,
  onExternal,
  fragment,
}: {
  markdown: string;
  onPage?: (address: string) => void;
  onExternal?: (url: string) => void;
  fragment?: string;
}) {
  return (
    <article
      data-page-prose
      className="min-w-0 overflow-x-auto break-words"
      ref={(node) => {
        if (node && fragment) {
          node.ownerDocument.getElementById(fragment)?.scrollIntoView();
        }
      }}
    >
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkTables, remarkHeadingIds]}
        urlTransform={(url) =>
          url.startsWith('context-use://page/') ? url : defaultUrlTransform(url)
        }
        components={{
          a: ({ href, children }) =>
            href?.startsWith('context-use://page/') && onPage ? (
              <button
                type="button"
                className="text-left underline underline-offset-4"
                onClick={() => onPage(href)}
              >
                {children}
              </button>
            ) : href && onExternal && /^(https?:|mailto:)/.test(href) ? (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault();
                  onExternal?.(href);
                }}
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt }) => (
            <span className="text-muted-foreground text-sm">
              Attached asset{alt ? `: ${alt}` : ''}
            </span>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
