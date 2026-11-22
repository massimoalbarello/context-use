import { PageProse } from '../components/pages/page-prose';

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
      className="min-w-0 overflow-x-auto break-words"
      ref={(node) => {
        if (node && fragment) {
          node.ownerDocument.getElementById(fragment)?.scrollIntoView();
        }
      }}
    >
      <PageProse
        markdown={markdown}
        link={({ href, children }) =>
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
              className="font-medium underline underline-offset-4"
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
          )
        }
        image={({ alt }) => (
          <span className="text-muted-foreground text-sm">
            Attached asset{alt ? `: ${alt}` : ''}
          </span>
        )}
      />
    </article>
  );
}
