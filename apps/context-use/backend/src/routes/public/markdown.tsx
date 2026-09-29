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
        img: ({ src, alt, className }) => (
          <span className={className}>
            {src && assetMedia[src] === 'application/pdf' ? (
              <iframe
                src={`${src}/preview`}
                title={alt || 'PDF preview'}
                loading="lazy"
                sandbox="allow-scripts allow-same-origin"
                className="pdf-preview"
              />
            ) : src && isVideoAssetMedia(assetMedia[src] ?? '') ? (
              // React's video types do not yet include the native loading attribute.
              <video
                src={src}
                aria-label={alt || 'Video'}
                controls
                playsInline
                preload="metadata"
                {...{ loading: 'lazy' }}
              >
                <a href={src}>{alt || 'Open video'}</a>
              </video>
            ) : (
              <img src={src} alt={alt ?? ''} loading="lazy" decoding="async" />
            )}
          </span>
        ),
        ...components,
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}
