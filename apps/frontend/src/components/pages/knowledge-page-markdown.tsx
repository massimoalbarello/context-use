import { isValidElement, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import { assetContentUrl } from '../../lib/asset-presentation';
import { cn } from '../../lib/class-names';
import type { EntitySummary } from '../../queries/entities';
import { EntityLink } from '../entities/entity-link';
import { KnowledgePageLink } from './knowledge-page-link';

type InternalLink =
  | { kind: 'entity'; readableId: string }
  | { kind: 'page'; readableId: string; fragment: string | undefined }
  | { kind: 'asset'; readableId: string };

type EntityMention = Pick<EntitySummary, 'readableId' | 'name' | 'image'>;

function internalLink(href: string): InternalLink | null {
  const match =
    /^context-use:\/\/(entity|page|asset)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:#([a-z0-9]+(?:-[a-z0-9]+)*))?$/.exec(
      href,
    );
  if (!match?.[1] || !match[2]) {
    return null;
  }
  if (match[1] === 'entity') {
    return { kind: 'entity', readableId: match[2] };
  }
  return match[1] === 'page'
    ? { kind: 'page', readableId: match[2], fragment: match[3] }
    : { kind: 'asset', readableId: match[2] };
}

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
  return textContent(children)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-');
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

export function KnowledgePageMarkdown({
  markdown,
  mentions = [],
}: {
  markdown: string;
  mentions?: EntityMention[];
}) {
  return (
    <article className="py-3 md:py-5">
      <ReactMarkdown
        urlTransform={(url) => (url.startsWith('context-use://') ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href, children }) => {
            const target = href ? internalLink(href) : null;
            if (target?.kind === 'entity') {
              const name = textContent(children);
              return (
                <EntityLink
                  entity={entityMentionFrom({ readableId: target.readableId, name, mentions })}
                  presentation="inline"
                >
                  {children}
                </EntityLink>
              );
            }
            if (target?.kind === 'page') {
              const title = textContent(children);
              return (
                <KnowledgePageLink
                  page={{ readableId: target.readableId, title }}
                  presentation="inline"
                  fragment={target.fragment}
                >
                  {children}
                </KnowledgePageLink>
              );
            }
            if (target?.kind === 'asset') {
              return (
                <a
                  className="font-medium text-foreground underline decoration-foreground/35 underline-offset-4 hover:decoration-foreground"
                  href={assetContentUrl(target.readableId)}
                >
                  {children}
                </a>
              );
            }
            return (
              <a
                className="font-medium text-foreground underline decoration-foreground/35 underline-offset-4 hover:decoration-foreground"
                href={href}
              >
                {children}
              </a>
            );
          },
          img: ({ src, alt }) => {
            const target = src ? internalLink(src) : null;
            if (target?.kind !== 'asset') {
              return null;
            }
            return (
              <img
                className="my-7 max-h-[36rem] w-full rounded-xl bg-muted object-contain"
                src={assetContentUrl(target.readableId)}
                alt={alt ?? ''}
              />
            );
          },
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
