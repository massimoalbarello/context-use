import { cn } from '@repo/ui/class-names';
import { InlineEntity } from '@repo/ui/inline-entity';
import { ReadingLink } from '@repo/ui/reading-link';
import { isValidElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { isVideoAssetMedia } from '#backend/models/assets/presentation.ts';
import { remarkAssetLayout } from '#backend/models/markdown/asset-layout.ts';
import { normalizeKnowledgeHeadingId } from '#backend/models/markdown/headings.ts';

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

export function PublicMarkdown({
  markdown,
  components,
  assetMedia = {},
  mentions = {},
  origin,
  fragmentBase,
}: {
  markdown: string;
  components?: Components;
  assetMedia?: Record<string, string>;
  mentions?: Record<string, { name: string; imageUrl: string | null }>;
  origin?: string;
  fragmentBase?: 'about:srcdoc';
}) {
  return (
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkAssetLayout]}
      components={{
        ...headings,
        a: ({ href, title, children }) => {
          const entity = href ? mentions[href] : undefined;
          const localFragment = fragmentBase && href?.startsWith('#');
          return entity ? (
            <a href={href} title={title} className="group/entity text-inherit no-underline">
              <InlineEntity {...entity}>{children}</InlineEntity>
            </a>
          ) : (
            <ReadingLink
              href={localFragment ? `${fragmentBase}${href}` : href}
              target={localFragment ? '_self' : undefined}
              title={title}
              origin={origin}
            >
              {children}
            </ReadingLink>
          );
        },
        div: ({ className, children }) => (
          <div
            className={cn(
              className,
              className === 'markdown-media-row' &&
                'my-7 flex flex-wrap gap-4 [&>.markdown-asset]:my-0',
            )}
          >
            {children}
          </div>
        ),
        img: ({ src, alt, className }) => {
          const isAsset = className?.split(' ').includes('markdown-asset');
          const mediaClassName = isAsset
            ? 'm-0 block max-h-[36rem] w-full rounded-[0.75rem] object-contain'
            : undefined;
          return (
            <span
              className={cn(
                className,
                isAsset &&
                  'my-7 block w-full min-w-0 [&.asset-center]:mx-auto sm:[&.asset-half]:w-[calc(50%-0.5rem)] [&.asset-left]:mr-auto [&.asset-medium]:max-w-lg [&.asset-right]:ml-auto [&.asset-small]:max-w-80 sm:[&.asset-third]:w-[calc((100%-2rem)/3)]',
              )}
            >
              {src && isVideoAssetMedia(assetMedia[src] ?? '') ? (
                // biome-ignore lint/a11y/useMediaCaption: uploaded videos do not have a paired caption asset.
                <video
                  className={mediaClassName}
                  src={src}
                  aria-label={alt || 'Video'}
                  controls
                  playsInline
                  preload="metadata"
                >
                  <a href={src}>{alt || 'Open video'}</a>
                </video>
              ) : (
                <img className={mediaClassName} src={src} alt={alt ?? ''} />
              )}
            </span>
          );
        },
        ...components,
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}
