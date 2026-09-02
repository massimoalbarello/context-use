import { isValidElement, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import { assetContentUrl } from '../../lib/asset-presentation';
import { cn } from '../../lib/class-names';
import type { EntitySummary } from '../../queries/entities';
import { EntityAvatar, EntityLink } from '../entities/entity-link';
import { KnowledgePageLink } from './knowledge-page-link';

type InternalLink =
  | { kind: 'entity'; readableId: string }
  | { kind: 'page'; readableId: string; fragment: string | undefined }
  | { kind: 'asset'; readableId: string };

export type KnowledgePageMarkdownSelection = {
  kind: InternalLink['kind'];
  readableId: string;
};

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

type SelectMarkdownResource = (selection: KnowledgePageMarkdownSelection) => void;

function EntityMarkdownLink({
  target,
  children,
  mentions,
  onSelectResource,
}: {
  target: Extract<InternalLink, { kind: 'entity' }>;
  children: ReactNode;
  mentions: EntityMention[];
  onSelectResource?: SelectMarkdownResource;
}) {
  const entity = entityMentionFrom({
    readableId: target.readableId,
    name: textContent(children),
    mentions,
  });
  if (onSelectResource) {
    return (
      <button
        type="button"
        className="relative mx-0.5 inline-block rounded-full bg-muted py-0.5 pr-2 pl-[2.0625rem] align-baseline font-medium text-foreground transition hover:bg-accent"
        onClick={() => onSelectResource(target)}
      >
        <EntityAvatar
          entity={entity}
          size="sm"
          className="absolute top-1/2 left-[0.3125rem] -translate-y-1/2 text-[0.6rem]"
        />
        <span>{children}</span>
      </button>
    );
  }
  return (
    <EntityLink entity={entity} presentation="inline">
      {children}
    </EntityLink>
  );
}

function PageMarkdownLink({
  target,
  children,
  onSelectResource,
}: {
  target: Extract<InternalLink, { kind: 'page' }>;
  children: ReactNode;
  onSelectResource?: SelectMarkdownResource;
}) {
  if (onSelectResource) {
    return (
      <button
        type="button"
        className="font-medium text-foreground underline decoration-foreground/35 underline-offset-4 transition hover:decoration-foreground"
        onClick={() => onSelectResource(target)}
      >
        {children}
      </button>
    );
  }
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

function AssetMarkdownLink({
  target,
  children,
  onSelectResource,
}: {
  target: Extract<InternalLink, { kind: 'asset' }>;
  children: ReactNode;
  onSelectResource?: SelectMarkdownResource;
}) {
  const className =
    'font-medium text-foreground underline decoration-foreground/35 underline-offset-4 hover:decoration-foreground';
  if (onSelectResource) {
    return (
      <button type="button" className={className} onClick={() => onSelectResource(target)}>
        {children}
      </button>
    );
  }
  return (
    <a className={className} href={assetContentUrl(target.readableId)}>
      {children}
    </a>
  );
}

function MarkdownLink({
  href,
  children,
  mentions,
  onSelectResource,
}: {
  href?: string;
  children: ReactNode;
  mentions: EntityMention[];
  onSelectResource?: SelectMarkdownResource;
}) {
  const target = href ? internalLink(href) : null;
  if (target?.kind === 'entity') {
    return (
      <EntityMarkdownLink target={target} mentions={mentions} onSelectResource={onSelectResource}>
        {children}
      </EntityMarkdownLink>
    );
  }
  if (target?.kind === 'page') {
    return (
      <PageMarkdownLink target={target} onSelectResource={onSelectResource}>
        {children}
      </PageMarkdownLink>
    );
  }
  if (target?.kind === 'asset') {
    return (
      <AssetMarkdownLink target={target} onSelectResource={onSelectResource}>
        {children}
      </AssetMarkdownLink>
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
}

function MarkdownImage({
  src,
  alt,
  onSelectResource,
}: {
  src?: string;
  alt?: string;
  onSelectResource?: SelectMarkdownResource;
}) {
  const target = src ? internalLink(src) : null;
  if (target?.kind !== 'asset') {
    return null;
  }
  if (!onSelectResource) {
    return (
      <img
        className="my-7 max-h-[36rem] w-full rounded-xl bg-muted object-contain"
        src={assetContentUrl(target.readableId)}
        alt={alt ?? ''}
      />
    );
  }
  return (
    <button
      type="button"
      className="my-7 block w-full"
      aria-label={`Open ${alt || 'asset'} preview`}
      onClick={() => onSelectResource(target)}
    >
      <img
        className="max-h-[36rem] w-full rounded-xl bg-muted object-contain"
        src={assetContentUrl(target.readableId)}
        alt={alt ?? ''}
      />
    </button>
  );
}

export function KnowledgePageMarkdown({
  markdown,
  mentions = [],
  onSelectResource,
}: {
  markdown: string;
  mentions?: EntityMention[];
  onSelectResource?: (selection: KnowledgePageMarkdownSelection) => void;
}) {
  return (
    <article className="py-3 md:py-5">
      <ReactMarkdown
        urlTransform={(url) => (url.startsWith('context-use://') ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href, children }) => (
            <MarkdownLink href={href} mentions={mentions} onSelectResource={onSelectResource}>
              {children}
            </MarkdownLink>
          ),
          img: ({ src, alt }) => (
            <MarkdownImage src={src} alt={alt} onSelectResource={onSelectResource} />
          ),
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
