import { ReadingLink } from '@repo/ui/reading-link';
import type { AssetPreview } from '../../queries/assets';
import type { EntitySummary } from '../../queries/entities';
import type { KnowledgePage } from '../../queries/pages';
import { AssetMarkdownEmbed, AssetMarkdownLink } from '../assets/asset-markdown';
import { EntityLink } from '../entities/entity-link';
import { RecordLink } from '../records/record-link';
import { KnowledgePageLink } from './knowledge-page-link';
import { markdownTextContent } from './markdown-heading';
import { type PageLinkProps, PageProse } from './page-prose';

type EntityMention = Pick<EntitySummary, 'readableId' | 'name' | 'image'>;
type RecordReference = Pick<KnowledgePage['recordReferences'][number], 'readableId' | 'available'>;

function MarkdownLink({
  href,
  target,
  children,
  mentions,
  recordReferences,
}: PageLinkProps & { mentions: EntityMention[]; recordReferences: RecordReference[] }) {
  if (target?.kind === 'entity') {
    return (
      <EntityLink
        entity={
          mentions.find((item) => item.readableId === target.readableId) ?? {
            readableId: target.readableId,
            name: markdownTextContent(children),
            image: null,
          }
        }
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
  const assetsById = new Map(assets.map((asset) => [asset.readableId, asset]));
  return (
    <PageProse
      markdown={markdown}
      renderLink={(props) => (
        <MarkdownLink {...props} mentions={mentions} recordReferences={recordReferences} />
      )}
      renderAsset={({ readableId, alt, linked, className }) => (
        <AssetMarkdownEmbed
          readableId={readableId}
          asset={assetsById.get(readableId)}
          alt={alt}
          linked={linked}
          className={className}
        />
      )}
    />
  );
}
