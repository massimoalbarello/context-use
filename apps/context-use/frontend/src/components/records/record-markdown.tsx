import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { remarkAssetLayout } from '#backend/models/markdown/asset-layout.ts';
import { internalLink } from '../../lib/internal-link';
import { AssetMarkdownEmbed, AssetMarkdownLink } from '../assets/asset-markdown';
import { markdownBodyComponents } from '../pages/page-prose';

export function externalRecordUrl(url: string): string {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:' ? url : '';
  } catch {
    return '';
  }
}

function ContextRecordLink({ href, children }: { href?: string; children: ReactNode }) {
  const asset = href ? internalLink(href) : null;
  if (asset?.kind === 'asset') {
    return <AssetMarkdownLink readableId={asset.readableId}>{children}</AssetMarkdownLink>;
  }
  if (!href) {
    return <span>{children}</span>;
  }
  return (
    <a
      className="font-medium text-foreground underline decoration-foreground/35 underline-offset-4 hover:decoration-foreground"
      href={href}
      target="_blank"
      rel="noreferrer noopener"
    >
      {children}
    </a>
  );
}

export function ContextRecordMarkdown({ markdown, label }: { markdown: string; label: string }) {
  return (
    <article className="py-3 md:py-5" aria-label={label}>
      <ReactMarkdown
        remarkPlugins={[remarkAssetLayout]}
        skipHtml
        urlTransform={(url) => (internalLink(url)?.kind === 'asset' ? url : externalRecordUrl(url))}
        components={{
          ...markdownBodyComponents,
          a: ({ href, children }) => <ContextRecordLink href={href}>{children}</ContextRecordLink>,
          img: ({ src, alt, className, node }) => {
            const asset = src ? internalLink(src) : null;
            return asset?.kind === 'asset' ? (
              <AssetMarkdownEmbed
                readableId={asset.readableId}
                alt={alt}
                className={className}
                linked={Boolean(node?.properties['data-asset-linked'])}
              />
            ) : alt ? (
              <span className="text-muted-foreground text-sm">Image: {alt}</span>
            ) : null;
          },
          h1: ({ children, node }) =>
            node?.position?.start.line === 1 && children === label ? null : (
              <h2 className="mb-7 font-semibold text-2xl tracking-tight">{children}</h2>
            ),
          h2: ({ children }) => (
            <h2 className="mt-10 border-border border-b pb-2 font-semibold text-2xl tracking-tight">
              {children}
            </h2>
          ),
          h3: ({ children }) => <h3 className="mt-8 font-semibold text-xl">{children}</h3>,
          h4: ({ children }) => <h4 className="mt-8 font-semibold text-xl">{children}</h4>,
          h5: ({ children }) => <h5 className="mt-8 font-semibold text-xl">{children}</h5>,
          h6: ({ children }) => <h6 className="mt-8 font-semibold text-xl">{children}</h6>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
