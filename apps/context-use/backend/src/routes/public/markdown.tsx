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
}: {
  markdown: string;
  components?: Components;
  assetMedia?: Record<string, string>;
}) {
  return (
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkAssetLayout]}
      components={{
        ...headings,
        img: ({ src, alt, className }) => (
          <span className={className}>
            {src && isVideoAssetMedia(assetMedia[src] ?? '') ? (
              // biome-ignore lint/a11y/useMediaCaption: uploaded videos do not have a paired caption asset.
              <video src={src} aria-label={alt || 'Video'} controls playsInline preload="metadata">
                <a href={src}>{alt || 'Open video'}</a>
              </video>
            ) : (
              <img src={src} alt={alt ?? ''} />
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
