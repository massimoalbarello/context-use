import { InlineEntity } from '@repo/ui/inline-entity';
import { ReadingLink } from '@repo/ui/reading-link';
import { isValidElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { isVideoAssetMedia } from '#backend/models/assets/presentation.ts';
import { remarkAssetLayout } from '#backend/models/markdown/asset-layout.ts';
import { normalizeKnowledgeHeadingId } from '#backend/models/markdown/headings.ts';
import type { PublicAssetMedia } from '#backend/models/public-resources/markdown.ts';

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
  assetMedia?: PublicAssetMedia;
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
            <PublicMedia src={src} alt={alt} media={assetMedia[src ?? '']} />
          </span>
        ),
        ...components,
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}

function PublicMedia({
  src,
  alt,
  media,
}: {
  src?: string;
  alt?: string;
  media?: PublicAssetMedia[string];
}) {
  if (src && media?.mediaType === 'application/pdf') {
    return (
      <iframe
        src={`/pdf-preview/${encodeURIComponent(src.split('/').at(-1)!)}`}
        title={alt || 'PDF preview'}
        loading="lazy"
        sandbox="allow-scripts allow-same-origin"
        className="pdf-preview"
      />
    );
  }
  const preview = media?.preview;
  const previewUrl = preview ? `${src}?preview=true` : undefined;
  if (src && isVideoAssetMedia(media?.mediaType ?? '')) {
    return (
      // React's video types do not yet include the native loading attribute.
      <video
        src={src}
        poster={previewUrl}
        width={preview?.width}
        height={preview?.height}
        aria-label={alt || 'Video'}
        controls
        playsInline
        preload={preview ? 'none' : 'metadata'}
        {...{ loading: 'lazy' }}
      >
        <a href={src}>{alt || 'Open video'}</a>
      </video>
    );
  }
  return (
    <img
      src={previewUrl ?? src}
      alt={alt ?? ''}
      width={preview?.width}
      height={preview?.height}
      loading="lazy"
      decoding="async"
    />
  );
}
