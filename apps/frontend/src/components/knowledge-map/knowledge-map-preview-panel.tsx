import { Link } from '@tanstack/react-router';
import { File, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { assetContentUrl, isEmbeddableAsset } from '../../lib/asset-presentation';
import { cn } from '../../lib/class-names';
import { useAssetPreview } from '../../lib/hooks/use-assets';
import { useEntityPreview } from '../../lib/hooks/use-entity';
import { usePagePreview } from '../../lib/hooks/use-page';
import type { Asset } from '../../queries/assets';
import type { KnowledgePageSummary } from '../../queries/pages';
import { formatAssetSize } from '../assets/asset-link';
import { EntityAvatar } from '../entities/entity-link';
import { resourceCardVariants } from '../knowledge/resource-list';
import { KnowledgePageCardContent } from '../pages/knowledge-page-link';
import { KnowledgePageMarkdown } from '../pages/knowledge-page-markdown';
import { Button, buttonVariants } from '../ui/button';
import type { KnowledgeMapSelection } from './knowledge-map-canvas';

function PreviewPanelShell({
  label,
  openLink,
  onClose,
  children,
}: {
  label: string;
  openLink: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      className="absolute right-2 bottom-2 left-2 z-30 flex max-h-[70%] flex-col overflow-hidden rounded-2xl border bg-card shadow-xl md:top-3 md:right-3 md:bottom-3 md:left-auto md:max-h-none md:w-[28rem]"
      aria-label={`${label} preview`}
    >
      <header className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
        <span className="min-w-0 flex-1 truncate font-medium text-muted-foreground text-sm">
          {label}
        </span>
        {openLink}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close preview"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
    </aside>
  );
}

function PreviewStatus({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-muted-foreground text-sm">{children}</p>;
}

function PreviewError({ error, retry }: { error: Error; retry: () => Promise<unknown> }) {
  return (
    <div className="grid justify-items-center gap-3 py-8 text-center">
      <p className="text-destructive text-sm">{error.message}</p>
      <Button type="button" variant="outline" size="sm" onClick={() => void retry()}>
        Try again
      </Button>
    </div>
  );
}

type PreviewPageItem = {
  page: KnowledgePageSummary;
  context?: string;
};

function PreviewPageSection({
  title,
  items,
  onSelect,
}: {
  title: string;
  items: PreviewPageItem[];
  onSelect: (selection: KnowledgeMapSelection) => void;
}) {
  return (
    <section className="border-t pt-5">
      <h3 className="font-semibold text-base">{title}</h3>
      {items.length > 0 ? (
        <ul className="mt-3 grid gap-2">
          {items.map(({ page, context }) => (
            <li key={page.readableId}>
              <button
                type="button"
                className={cn(resourceCardVariants(), 'h-auto min-h-20 w-full transition')}
                onClick={() => onSelect({ kind: 'page', readableId: page.readableId })}
              >
                <KnowledgePageCardContent page={page} />
                {context && (
                  <small className="shrink-0 text-muted-foreground text-xs">{context}</small>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-muted-foreground text-sm">None yet.</p>
      )}
    </section>
  );
}

function assetPreviewPages(usages: Asset['usages']): PreviewPageItem[] {
  const pages = new Map<
    string,
    { page: KnowledgePageSummary; presentations: Set<'embed' | 'attachment'> }
  >();
  for (const usage of usages) {
    if (usage.kind !== 'page') {
      continue;
    }
    const existing = pages.get(usage.page.readableId);
    if (existing) {
      existing.presentations.add(usage.presentation);
    } else {
      pages.set(usage.page.readableId, {
        page: usage.page,
        presentations: new Set([usage.presentation]),
      });
    }
  }
  return [...pages.values()].map(({ page, presentations }) => ({
    page,
    context:
      presentations.size === 2
        ? 'Embedded · Attached'
        : presentations.has('embed')
          ? 'Embedded'
          : 'Attached',
  }));
}

function PagePreview({
  readableId,
  onClose,
  onSelect,
}: {
  readableId: string;
  onClose: () => void;
  onSelect: (selection: KnowledgeMapSelection) => void;
}) {
  const { data: page, error, refetch } = usePagePreview(readableId);
  return (
    <PreviewPanelShell
      label="Knowledge page"
      onClose={onClose}
      openLink={
        <Link
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          to="/pages/$id"
          params={{ id: readableId }}
          search={{ view: 'preview' }}
          aria-label="Open knowledge page"
        >
          Open page
        </Link>
      }
    >
      {error ? (
        <PreviewError error={error} retry={refetch} />
      ) : page ? (
        <KnowledgePageMarkdown
          markdown={page.markdown}
          mentions={page.mentions}
          onSelectResource={onSelect}
        />
      ) : (
        <PreviewStatus>Loading page…</PreviewStatus>
      )}
    </PreviewPanelShell>
  );
}

function EntityPreview({
  readableId,
  onClose,
  onSelect,
}: {
  readableId: string;
  onClose: () => void;
  onSelect: (selection: KnowledgeMapSelection) => void;
}) {
  const { data: entity, error, refetch } = useEntityPreview(readableId);
  return (
    <PreviewPanelShell
      label="Entity"
      onClose={onClose}
      openLink={
        <Link
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          to="/entities/$id"
          params={{ id: readableId }}
          aria-label="Open entity"
        >
          Open entity
        </Link>
      }
    >
      {error ? (
        <PreviewError error={error} retry={refetch} />
      ) : entity ? (
        <div className="grid gap-5 py-2">
          <EntityAvatar entity={entity} className="size-20 text-2xl" />
          <div>
            <h2 className="font-semibold text-2xl tracking-tight">{entity.name}</h2>
            <p className="mt-3 text-muted-foreground leading-relaxed">{entity.description}</p>
          </div>
          <PreviewPageSection
            title="Mentioned by knowledge pages"
            items={entity.pages.map((page) => ({ page }))}
            onSelect={onSelect}
          />
        </div>
      ) : (
        <PreviewStatus>Loading entity…</PreviewStatus>
      )}
    </PreviewPanelShell>
  );
}

function AssetPreview({
  readableId,
  onClose,
  onSelect,
}: {
  readableId: string;
  onClose: () => void;
  onSelect: (selection: KnowledgeMapSelection) => void;
}) {
  const { data: asset, error, refetch } = useAssetPreview(readableId);
  return (
    <PreviewPanelShell
      label="Asset"
      onClose={onClose}
      openLink={
        <Link
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          to="/assets/$id"
          params={{ id: readableId }}
          aria-label="Open asset"
        >
          Open asset
        </Link>
      }
    >
      {error ? (
        <PreviewError error={error} retry={refetch} />
      ) : asset ? (
        <div className="grid gap-5 py-2">
          <div
            className={cn(
              'flex min-h-48 items-center justify-center overflow-hidden rounded-xl bg-muted text-muted-foreground',
              isEmbeddableAsset(asset) && 'min-h-0',
            )}
          >
            {isEmbeddableAsset(asset) ? (
              <img
                className="max-h-80 w-full object-contain"
                src={assetContentUrl(asset.readableId)}
                alt={asset.name}
              />
            ) : (
              <File className="size-12 stroke-[1.3]" aria-hidden="true" />
            )}
          </div>
          <div>
            <h2 className="font-semibold text-2xl tracking-tight">{asset.name}</h2>
            <p className="mt-2 text-muted-foreground text-sm">
              {asset.extension?.toUpperCase() ?? asset.mediaType} ·{' '}
              {formatAssetSize(asset.sizeBytes)}
            </p>
          </div>
          <PreviewPageSection
            title="Used by knowledge pages"
            items={assetPreviewPages(asset.usages)}
            onSelect={onSelect}
          />
        </div>
      ) : (
        <PreviewStatus>Loading asset…</PreviewStatus>
      )}
    </PreviewPanelShell>
  );
}

export function KnowledgeMapPreviewPanel({
  selection,
  onClose,
  onSelect,
}: {
  selection: KnowledgeMapSelection;
  onClose: () => void;
  onSelect: (selection: KnowledgeMapSelection) => void;
}) {
  if (selection.kind === 'page') {
    return <PagePreview readableId={selection.readableId} onClose={onClose} onSelect={onSelect} />;
  }
  if (selection.kind === 'entity') {
    return (
      <EntityPreview readableId={selection.readableId} onClose={onClose} onSelect={onSelect} />
    );
  }
  return <AssetPreview readableId={selection.readableId} onClose={onClose} onSelect={onSelect} />;
}
