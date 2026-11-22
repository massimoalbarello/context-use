import { ReadingLink } from '@repo/ui/reading-link';
import { createContext, type ReactNode, useContext } from 'react';
import type { ExtraProps } from 'react-markdown';
import { internalLink } from '../../lib/internal-link';
import type { AssetPreview } from '../../queries/assets';
import type { EntitySummary } from '../../queries/entities';
import type { KnowledgePage } from '../../queries/pages';
import { AssetMarkdownEmbed, AssetMarkdownLink } from '../assets/asset-markdown';
import { EntityLink } from '../entities/entity-link';
import { RecordLink } from '../records/record-link';
import { KnowledgePageLink } from './knowledge-page-link';
import { markdownTextContent } from './markdown-heading';
import { PageProse } from './page-prose';

type EntityMention = Pick<EntitySummary, 'readableId' | 'name' | 'image'>;
type RecordReference = Pick<KnowledgePage['recordReferences'][number], 'readableId' | 'available'>;

const MarkdownReferences = createContext<{
  mentions: EntityMention[];
  recordReferences: RecordReference[];
  assets: ReadonlyMap<string, AssetPreview>;
}>({ mentions: [], recordReferences: [], assets: new Map() });

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

function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
  const { mentions, recordReferences } = useContext(MarkdownReferences);
  const target = href ? internalLink(href) : null;
  if (target?.kind === 'entity') {
    return (
      <EntityLink
        entity={entityMentionFrom({
          readableId: target.readableId,
          name: markdownTextContent(children),
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
        record={{ readableId: target.readableId, title: markdownTextContent(children) }}
        presentation="inline"
      >
        {children}
      </RecordLink>
    );
  }
  if (target?.kind === 'page') {
    return (
      <KnowledgePageLink
        page={{ readableId: target.readableId, title: markdownTextContent(children) }}
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
    <ReadingLink
      origin={globalThis.location?.origin}
      className="font-medium text-foreground underline decoration-foreground/35 underline-offset-4 hover:decoration-foreground"
      href={href}
    >
      {children}
    </ReadingLink>
  );
}

function MarkdownImage({
  src,
  alt,
  className,
  node,
}: ExtraProps & {
  src?: string;
  alt?: string;
  className?: string;
}) {
  const { assets } = useContext(MarkdownReferences);
  const target = src ? internalLink(src) : null;
  if (target?.kind !== 'asset') {
    return null;
  }
  return (
    <AssetMarkdownEmbed
      readableId={target.readableId}
      asset={assets.get(target.readableId)}
      alt={alt}
      className={className}
      linked={Boolean(node?.properties['data-asset-linked'])}
    />
  );
}

export function KnowledgePageMarkdown({
  markdown,
  mentions = [],
  recordReferences = [],
  assets = [],
}: {
  markdown: string;
  mentions?: EntityMention[];
  recordReferences?: RecordReference[];
  assets?: AssetPreview[];
}) {
  return (
    <MarkdownReferences
      value={{
        mentions,
        recordReferences,
        assets: new Map(assets.map((asset) => [asset.readableId, asset])),
      }}
    >
      <article className="py-3 md:py-5">
        <PageProse markdown={markdown} link={MarkdownLink} image={MarkdownImage} />
      </article>
    </MarkdownReferences>
  );
}
