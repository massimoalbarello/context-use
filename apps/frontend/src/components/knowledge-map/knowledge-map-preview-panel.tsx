import { Link } from '@tanstack/react-router';
import { File, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { assetContentUrl, isEmbeddableAsset } from '../../lib/asset-presentation';
import { cn } from '../../lib/class-names';
import { useAsset } from '../../lib/hooks/use-assets';
import { useEntity } from '../../lib/hooks/use-entity';
import { usePage } from '../../lib/hooks/use-page';
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

function PagePreview({ readableId, onClose }: { readableId: string; onClose: () => void }) {
  const { data: page, error } = usePage(readableId);
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
        <PreviewStatus>{error.message}</PreviewStatus>
      ) : page ? (
        <KnowledgePageMarkdown markdown={page.markdown} mentions={page.mentions} />
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
  const { data: entity, error } = useEntity(readableId);
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
        <PreviewStatus>{error.message}</PreviewStatus>
      ) : entity ? (
        <div className="grid gap-5 py-2">
          <EntityAvatar entity={entity} className="size-20 text-2xl" />
          <div>
            <h2 className="font-semibold text-2xl tracking-tight">{entity.name}</h2>
            <p className="mt-3 text-muted-foreground leading-relaxed">{entity.description}</p>
          </div>
          <section className="border-t pt-5">
            <h3 className="font-semibold text-base">Mentioned by knowledge pages</h3>
            {entity.pages.length > 0 ? (
              <ul className="mt-3 grid gap-2">
                {entity.pages.map((page) => (
                  <li key={page.readableId}>
                    <button
                      type="button"
                      className={cn(resourceCardVariants(), 'h-auto min-h-20 w-full transition')}
                      onClick={() => onSelect({ kind: 'page', readableId: page.readableId })}
                    >
                      <KnowledgePageCardContent page={page} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-muted-foreground text-sm">None yet.</p>
            )}
          </section>
        </div>
      ) : (
        <PreviewStatus>Loading entity…</PreviewStatus>
      )}
    </PreviewPanelShell>
  );
}

function AssetPreview({ readableId, onClose }: { readableId: string; onClose: () => void }) {
  const { data: asset, error } = useAsset(readableId);
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
        <PreviewStatus>{error.message}</PreviewStatus>
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
    return <PagePreview readableId={selection.readableId} onClose={onClose} />;
  }
  if (selection.kind === 'entity') {
    return (
      <EntityPreview readableId={selection.readableId} onClose={onClose} onSelect={onSelect} />
    );
  }
  return <AssetPreview readableId={selection.readableId} onClose={onClose} />;
}
