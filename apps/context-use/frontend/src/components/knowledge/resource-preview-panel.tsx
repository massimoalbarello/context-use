import { Button } from '@repo/ui/button';
import { cn } from '@repo/ui/class-names';
import { Expand, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAsset } from '../../lib/hooks/use-assets';
import { useEntityPreview } from '../../lib/hooks/use-entity';
import { usePagePreview } from '../../lib/hooks/use-page';
import { useRecord } from '../../lib/hooks/use-records';
import type { ResourceSelection } from '../../lib/resource-selection';
import type { KnowledgePageSummary } from '../../queries/pages';
import { formatAssetSize } from '../assets/asset-link';
import { AssetMedia } from '../assets/asset-media';
import { EntityAvatar } from '../entities/entity-link';
import { resourceCardVariants } from '../knowledge/resource-list';
import { KnowledgePageCardContent, KnowledgePageLink } from '../pages/knowledge-page-link';
import { KnowledgePageMarkdown } from '../pages/knowledge-page-markdown';
import { TemporalCoverageLabel } from '../pages/temporal-coverage-label';
import { ExternalRecordMarkdown } from '../records/external-record-markdown';

function focusPreviewPanel(panel: HTMLElement | null) {
  panel?.focus();
}

function PreviewPanelShell({
  label,
  context,
  onExpand,
  onClose,
  children,
}: {
  label: string;
  context?: ReactNode;
  onExpand: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      className="absolute top-3 right-3 bottom-3 z-30 flex w-[28rem] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-2xl border bg-card shadow-xl"
      aria-label={`${label} preview`}
      tabIndex={-1}
      ref={focusPreviewPanel}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) {
          return;
        }
        event.preventDefault();
        onClose();
      }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="truncate font-medium text-muted-foreground text-sm">{label}</span>
          {context}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onExpand}>
          <Expand aria-hidden="true" />
          Expand
        </Button>
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

function PreviewPageSection({
  pages,
  onSelect,
}: {
  pages: KnowledgePageSummary[];
  onSelect: (selection: ResourceSelection) => void;
}) {
  return (
    <section className="border-t pt-5">
      <h3 className="font-semibold text-base">Mentioned by knowledge pages</h3>
      {pages.length > 0 ? (
        <ul className="mt-3 grid gap-2">
          {pages.map((page) => (
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
  );
}

type PreviewProps = {
  onExpand: () => void;
  readableId: string;
  onClose: () => void;
  onSelect: (selection: ResourceSelection) => void;
};

function PagePreview({ readableId, onClose, onSelect, onExpand }: PreviewProps) {
  const { data: page, error, refetch } = usePagePreview(readableId);
  return (
    <PreviewPanelShell
      label="Knowledge page"
      context={
        page?.temporalCoverage ? (
          <TemporalCoverageLabel
            className="max-w-full text-xs"
            expression={page.temporalCoverage}
          />
        ) : null
      }
      onClose={onClose}
      onExpand={onExpand}
    >
      {error ? (
        <PreviewError error={error} retry={refetch} />
      ) : page ? (
        <KnowledgePageMarkdown
          markdown={page.markdown}
          mentions={page.mentions}
          recordReferences={page.recordReferences}
          onSelectResource={onSelect}
        />
      ) : (
        <PreviewStatus>Loading page…</PreviewStatus>
      )}
    </PreviewPanelShell>
  );
}

function EntityPreview({ readableId, onClose, onSelect, onExpand }: PreviewProps) {
  const { data: entity, error, refetch } = useEntityPreview(readableId);
  return (
    <PreviewPanelShell label="Entity" onClose={onClose} onExpand={onExpand}>
      {error ? (
        <PreviewError error={error} retry={refetch} />
      ) : entity ? (
        <div className="grid gap-5 py-2">
          <EntityAvatar entity={entity} className="size-20 text-2xl" />
          <div>
            <h2 className="font-semibold text-2xl tracking-tight">{entity.name}</h2>
            <p className="mt-3 text-muted-foreground leading-relaxed">{entity.description}</p>
          </div>
          <PreviewPageSection pages={entity.pages} onSelect={onSelect} />
        </div>
      ) : (
        <PreviewStatus>Loading entity…</PreviewStatus>
      )}
    </PreviewPanelShell>
  );
}

export function ResourcePreviewPanel({
  selection,
  onExpand,
  onClose,
  onSelect,
}: {
  selection: ResourceSelection;
  onExpand: () => void;
  onClose: () => void;
  onSelect: (selection: ResourceSelection) => void;
}) {
  const key = `${selection.kind}:${selection.readableId}`;

  if (selection.kind === 'asset') {
    return (
      <AssetPreview
        key={key}
        readableId={selection.readableId}
        onClose={onClose}
        onExpand={onExpand}
      />
    );
  }
  if (selection.kind === 'record') {
    return (
      <RecordPreview
        key={key}
        readableId={selection.readableId}
        onClose={onClose}
        onExpand={onExpand}
      />
    );
  }
  if (selection.kind === 'page') {
    return (
      <PagePreview
        onExpand={onExpand}
        key={key}
        readableId={selection.readableId}
        onClose={onClose}
        onSelect={onSelect}
      />
    );
  }
  return (
    <EntityPreview
      onExpand={onExpand}
      key={key}
      readableId={selection.readableId}
      onClose={onClose}
      onSelect={onSelect}
    />
  );
}

function AssetPreview({ readableId, onClose, onExpand }: Omit<PreviewProps, 'onSelect'>) {
  const { data: asset, error, refetch } = useAsset(readableId);
  return (
    <PreviewPanelShell label="Asset" onClose={onClose} onExpand={onExpand}>
      {error ? (
        <PreviewError error={error} retry={refetch} />
      ) : asset ? (
        <div className="grid gap-5">
          <h2 className="break-words font-semibold text-2xl">{asset.name}</h2>
          <p className="text-muted-foreground text-sm">
            {asset.mediaType} · {formatAssetSize(asset.sizeBytes)}
          </p>
          <AssetMedia asset={asset} className="max-h-96 w-full rounded-lg object-contain" />
        </div>
      ) : (
        <PreviewStatus>Loading asset…</PreviewStatus>
      )}
    </PreviewPanelShell>
  );
}

function RecordPreview({ readableId, onClose, onExpand }: Omit<PreviewProps, 'onSelect'>) {
  const { data: record, error, refetch } = useRecord(readableId);
  return (
    <PreviewPanelShell label="Record" onClose={onClose} onExpand={onExpand}>
      {error ? (
        <PreviewError error={error} retry={refetch} />
      ) : record ? (
        <div className="grid gap-4">
          <h2 className="font-semibold text-2xl">{record.title}</h2>
          <p className="text-muted-foreground text-sm">
            {record.provider} · {record.kind}
          </p>
          <ExternalRecordMarkdown markdown={record.markdown} label={record.title} />
          {record.backlinks.length > 0 && (
            <section className="grid gap-2 border-t pt-4">
              <h3 className="font-semibold">Referenced by</h3>
              {record.backlinks.map((page) => (
                <KnowledgePageLink key={page.readableId} page={page} presentation="card" />
              ))}
            </section>
          )}
        </div>
      ) : (
        <PreviewStatus>Loading record…</PreviewStatus>
      )}
    </PreviewPanelShell>
  );
}
