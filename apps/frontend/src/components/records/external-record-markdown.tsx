import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { isEmbeddableAsset } from '../../lib/asset-presentation';
import { cn } from '../../lib/class-names';
import type { AssetSummary } from '../../queries/assets';
import { AssetLink } from '../assets/asset-link';
import { AssetMedia } from '../assets/asset-media';

export function externalRecordUrl(url: string): string {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:' ? url : '';
  } catch {
    return '';
  }
}

function ExternalRecordLink({ href, children }: { href?: string; children: ReactNode }) {
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

export function ExternalRecordMarkdown({
  markdown,
  label,
  assets = [],
}: {
  markdown: string;
  label: string;
  assets?: AssetSummary[];
}) {
  const linkedAssets = new Map(
    assets.map((asset) => [`context-use://asset/${asset.readableId}`, asset]),
  );
  return (
    <article className="py-3 md:py-5" aria-label={label}>
      <ReactMarkdown
        skipHtml
        urlTransform={(url) => (linkedAssets.has(url) ? url : externalRecordUrl(url))}
        components={{
          a: ({ href, children }) => {
            const asset = href ? linkedAssets.get(href) : undefined;
            return asset ? (
              <AssetLink asset={asset} presentation="inline">
                {children}
              </AssetLink>
            ) : (
              <ExternalRecordLink href={href}>{children}</ExternalRecordLink>
            );
          },
          img: ({ src, alt }) => {
            const asset = src ? linkedAssets.get(src) : undefined;
            if (asset && isEmbeddableAsset(asset)) {
              return (
                <AssetMedia
                  asset={{ ...asset, name: alt ?? asset.name }}
                  className="max-w-full rounded-lg"
                />
              );
            }
            return asset ? (
              <AssetLink asset={asset} presentation="inline">
                {alt ?? asset.name}
              </AssetLink>
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
          p: ({ children }) => <p className="my-5 text-[1.05rem] leading-8">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-5 list-disc pl-6 text-[1.05rem] leading-8">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-5 list-decimal pl-6 text-[1.05rem] leading-8">{children}</ol>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-5 border-border border-l-4 pl-5 text-[1.05rem] text-muted-foreground leading-8">
              {children}
            </blockquote>
          ),
          code: ({ className, children }) => (
            <code className={cn('rounded bg-muted px-1.5 py-0.5 font-mono text-sm', className)}>
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-lg bg-foreground p-4 text-background [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit">
              {children}
            </pre>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
