import { cn } from '@repo/ui/class-names';
import { isValidElement, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import { normalizeKnowledgeHeadingId } from '#backend/models/markdown/headings.ts';
import { internalLink } from '../../lib/internal-link';
import type { EntitySummary } from '../../queries/entities';
import type { KnowledgePage } from '../../queries/pages';
import { AssetMarkdownImage, AssetMarkdownLink } from '../assets/asset-markdown';
import { EntityLink } from '../entities/entity-link';
import { RecordLink } from '../records/record-link';
import { KnowledgePageLink } from './knowledge-page-link';

type EntityMention = Pick<EntitySummary, 'readableId' | 'name' | 'image'>;
type RecordReference = Pick<KnowledgePage['recordReferences'][number], 'readableId' | 'available'>;

function textContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textContent).join('');
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textContent(node.props.children);
  }
  return '';
}

export function knowledgeHeadingId(children: ReactNode): string {
  return normalizeKnowledgeHeadingId(textContent(children));
}

export function entityMentionFrom({
  readableId,
  name,
  mentions,
}: {
  readableId: string;
  name: string;
  mentions: EntityMention[];
}): EntityMention {
  return (
    mentions.find((entity) => entity.readableId === readableId) ?? { readableId, name, image: null }
  );
}

function MarkdownLink({
  href,
  children,
  mentions,
  recordReferences,
}: {
  href?: string;
  children: ReactNode;
  mentions: EntityMention[];
  recordReferences: RecordReference[];
}) {
  const target = href ? internalLink(href) : null;
  if (target?.kind === 'entity') {
    return (
      <EntityLink
        entity={entityMentionFrom({
          readableId: target.readableId,
          name: textContent(children),
          mentions,
        })}
        presentation="inline"
      >
        {children}
      </EntityLink>
    );
  }
  if (target?.kind === 'record') {
    if (
      recordReferences.some(
        (record) => record.readableId === target.readableId && !record.available,
      )
    ) {
      return (
        <span className="text-muted-foreground">
          {children} <span className="text-sm">(record unavailable)</span>
        </span>
      );
    }
    return (
      <RecordLink
        record={{ readableId: target.readableId, title: textContent(children) }}
        presentation="inline"
      >
        {children}
      </RecordLink>
    );
  }
  if (target?.kind === 'page') {
    return (
      <KnowledgePageLink
        page={{ readableId: target.readableId, title: textContent(children) }}
        presentation="inline"
        fragment={target.fragment}
      >
        {children}
      </KnowledgePageLink>
    );
  }
  if (target?.kind === 'asset') {
    return <AssetMarkdownLink readableId={target.readableId}>{children}</AssetMarkdownLink>;
  }
  return (
    <a
      className="font-medium text-foreground underline decoration-foreground/35 underline-offset-4 hover:decoration-foreground"
      href={href}
    >
      {children}
    </a>
  );
}

function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const target = src ? internalLink(src) : null;
  if (target?.kind !== 'asset') {
    return null;
  }
  return <AssetMarkdownImage readableId={target.readableId} alt={alt} />;
}

export function KnowledgePageMarkdown({
  markdown,
  mentions = [],
  recordReferences = [],
}: {
  markdown: string;
  mentions?: EntityMention[];
  recordReferences?: RecordReference[];
}) {
  return (
    <article className="py-3 md:py-5">
      <ReactMarkdown
        skipHtml
        urlTransform={(url) => (url.startsWith('context-use://') ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href, children }) => (
            <MarkdownLink href={href} mentions={mentions} recordReferences={recordReferences}>
              {children}
            </MarkdownLink>
          ),
          img: ({ src, alt }) => <MarkdownImage src={src} alt={alt} />,
          h1: ({ children }) => (
            <h1 className="mb-7 font-semibold text-4xl tracking-tight">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2
              className="mt-10 scroll-mt-24 border-border border-b pb-2 font-semibold text-2xl tracking-tight"
              id={knowledgeHeadingId(children)}
            >
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3
              className="mt-8 scroll-mt-24 font-semibold text-xl"
              id={knowledgeHeadingId(children)}
            >
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4
              className="mt-8 scroll-mt-24 font-semibold text-xl"
              id={knowledgeHeadingId(children)}
            >
              {children}
            </h4>
          ),
          h5: ({ children }) => (
            <h5
              className="mt-8 scroll-mt-24 font-semibold text-xl"
              id={knowledgeHeadingId(children)}
            >
              {children}
            </h5>
          ),
          h6: ({ children }) => (
            <h6
              className="mt-8 scroll-mt-24 font-semibold text-xl"
              id={knowledgeHeadingId(children)}
            >
              {children}
            </h6>
          ),
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
