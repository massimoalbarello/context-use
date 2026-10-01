import { cn } from '@repo/ui/class-names';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { remarkAssetLayout } from '#backend/models/markdown/asset-layout.ts';
import { internalLink } from '../../lib/internal-link';
import { AssetMarkdownEmbed, AssetMarkdownLink } from '../assets/asset-markdown';

export function externalRecordUrl(url: string): string {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:' ? url : '';
  } catch {
    return '';
  }
}

function youtubeRecordVideo(text: string) {
  if (!text.startsWith('Video: ')) {
    return null;
  }
  try {
    const url = new URL(text.slice('Video: '.length));
    const videoId = url.searchParams.get('v');
    if (
      url.origin !== 'https://www.youtube.com' ||
      url.pathname !== '/watch' ||
      !videoId ||
      !/^[a-zA-Z0-9_-]{11}$/.test(videoId)
    ) {
      return null;
    }
    return {
      watchUrl: url.href,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
    };
  } catch {
    return null;
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
          p: ({ children, node }) => {
            const text = node?.children.length === 1 ? node.children[0] : null;
            const video = text?.type === 'text' ? youtubeRecordVideo(text.value) : null;
            return video ? (
              <div className="my-5">
                <iframe
                  className="aspect-video min-h-[200px] w-full rounded-lg"
                  src={video.embedUrl}
                  title={`YouTube video: ${label}`}
                  loading="lazy"
                  allow="encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
                <p className="mt-3 text-sm">
                  <ContextRecordLink href={video.watchUrl}>Watch on YouTube</ContextRecordLink>
                </p>
              </div>
            ) : (
              <p className="my-5 text-[1.05rem] leading-8">{children}</p>
            );
          },
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
