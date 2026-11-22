import { cn } from '@repo/ui/class-names';
import { createContext, type ReactNode, type Ref, useContext } from 'react';
import ReactMarkdown, { type Components, defaultUrlTransform } from 'react-markdown';
import { remarkAssetLayout } from '#backend/models/markdown/asset-layout.ts';
import { remarkTables } from '#backend/models/markdown/tables.ts';
import { internalLink } from '../../lib/internal-link';
import { markdownBodyComponents } from '../markdown/markdown-body';
import { headingId } from '../markdown/markdown-heading';
import { markdownTableComponents } from '../markdown/markdown-table';

const markdownComponents: Components = {
  ...markdownBodyComponents,
  ...markdownTableComponents,
  h1: ({ children }) => (
    <h1 id={headingId(children)} className="mb-7 font-semibold text-4xl tracking-tight">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2
      className="mt-10 scroll-mt-24 border-border border-b pb-2 font-semibold text-2xl tracking-tight"
      id={headingId(children)}
    >
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-8 scroll-mt-24 font-semibold text-xl" id={headingId(children)}>
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-8 scroll-mt-24 font-semibold text-xl" id={headingId(children)}>
      {children}
    </h4>
  ),
  h5: ({ children }) => (
    <h5 className="mt-8 scroll-mt-24 font-semibold text-xl" id={headingId(children)}>
      {children}
    </h5>
  ),
  h6: ({ children }) => (
    <h6 className="mt-8 scroll-mt-24 font-semibold text-xl" id={headingId(children)}>
      {children}
    </h6>
  ),
};

export type PageLinkProps = {
  href: string;
  target: ReturnType<typeof internalLink>;
  children: ReactNode;
};

type PageRenderers = {
  renderLink: (props: PageLinkProps) => ReactNode;
  renderAsset: (props: {
    address: string;
    readableId: string;
    alt?: string;
    className?: string;
    linked: boolean;
  }) => ReactNode;
};

const PageReferences = createContext<PageRenderers | null>(null);

const pageComponents: Components = {
  ...markdownComponents,
  a: function PageLink({ href = '', children }) {
    return useContext(PageReferences)?.renderLink({ href, target: internalLink(href), children });
  },
  img: function PageAsset({ src = '', alt, className, node }) {
    const references = useContext(PageReferences);
    const target = internalLink(src);
    if (target?.kind !== 'asset') {
      return null;
    }
    return references?.renderAsset({
      address: src,
      readableId: target.readableId,
      alt,
      className,
      linked: Boolean(node?.properties['data-asset-linked']),
    });
  },
};

export function PageProse({
  markdown,
  articleRef,
  className,
  renderLink,
  renderAsset,
}: PageRenderers & { markdown: string; articleRef?: Ref<HTMLElement>; className?: string }) {
  return (
    <article className={cn('py-3 md:py-5', className)} ref={articleRef}>
      <PageReferences value={{ renderLink, renderAsset }}>
        <ReactMarkdown
          skipHtml
          remarkPlugins={[remarkTables, remarkAssetLayout]}
          urlTransform={(url) =>
            url.startsWith('context-use://') ? url : defaultUrlTransform(url)
          }
          components={pageComponents}
        >
          {markdown}
        </ReactMarkdown>
      </PageReferences>
    </article>
  );
}
