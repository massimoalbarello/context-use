import { Button } from '@repo/ui/button';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Expand, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAssetPreview } from '../../lib/hooks/use-assets';
import { useEntityPreview } from '../../lib/hooks/use-entity';
import { usePagePreview } from '../../lib/hooks/use-page';
import { useRecord } from '../../lib/hooks/use-records';
import type { ResourceSelection } from '../../lib/resource-selection';
import { entityPagesQueryOptions } from '../../queries/pages';
import { publicationStatusQueryOptions } from '../../queries/publications';
import { AssetFileActions } from '../assets/asset-file-actions';
import { AssetMedia } from '../assets/asset-media';
import { AssetPreviewContent } from '../assets/asset-preview-content';
import { EntityAvatar } from '../entities/entity-link';
import { EntityProfile } from '../entities/entity-profile';
import { KnowledgePageLink } from '../pages/knowledge-page-link';
import { KnowledgePageMarkdown } from '../pages/knowledge-page-markdown';
import { TemporalCoverageLabel } from '../pages/temporal-coverage-label';
import { PublicationStatus } from '../publications/publication-status';
import { ContextRecordMarkdown } from '../records/record-markdown';
import { ArchivedStatus } from './archived-resource-detail';
import { InfiniteScrollTrigger } from './infinite-scroll-trigger';
import { RelatedPageList } from './resource-list';
import { ResourceScrollArea } from './resource-scroll-area';

function focusPreviewPanel(panel: HTMLElement | null) {
  panel?.focus({ preventScroll: true });
}

function PreviewPanelShell({
  label,
  publicationStatus,
  context,
  onExpand,
  onClose,
  children,
}: {
  label: string;
  publicationStatus: ReactNode;
  context?: ReactNode;
  onExpand: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      className="absolute top-3 right-3 bottom-3 z-30 flex w-[clamp(28rem,40%,56rem)] max-w-[calc(100%-1.5rem)] flex-col overflow-clip rounded-2xl border bg-card shadow-xl"
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
          {publicationStatus}
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
      <ResourceScrollArea className="px-5 py-4">{children}</ResourceScrollArea>
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

type PreviewProps = {
  publicationStatus: ReactNode;
  onExpand: () => void;
  readableId: string;
  onClose: () => void;
};

function PagePreview({ readableId, publicationStatus, onClose, onExpand }: PreviewProps) {
  const { data: page, error, refetch } = usePagePreview(readableId);
  return (
    <PreviewPanelShell
      label="Knowledge page"
      publicationStatus={
        page?.archivedAt ? (
          <ArchivedStatus archivedAt={page.archivedAt} />
        ) : page ? (
          publicationStatus
        ) : null
      }
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
        />
      ) : (
        <PreviewStatus>Loading page…</PreviewStatus>
      )}
    </PreviewPanelShell>
  );
}

function EntityPreview({ readableId, publicationStatus, onClose, onExpand }: PreviewProps) {
  const { data: entity, error, refetch } = useEntityPreview(readableId);
  return (
    <PreviewPanelShell
      label="Entity"
      publicationStatus={
        entity?.archivedAt ? (
          <ArchivedStatus archivedAt={entity.archivedAt} />
        ) : entity ? (
          publicationStatus
        ) : null
      }
      onClose={onClose}
      onExpand={onExpand}
    >
      {error ? (
        <PreviewError error={error} retry={refetch} />
      ) : entity ? (
        <div className="grid gap-5 py-2">
          <EntityProfile
            entity={entity}
            portrait={<EntityAvatar entity={entity} className="size-20 text-2xl" />}
            heading={<h2 className="font-semibold text-2xl tracking-tight">{entity.name}</h2>}
          />
          {!entity.archivedAt && <EntityMentioningPages readableId={readableId} />}
        </div>
      ) : (
        <PreviewStatus>Loading entity…</PreviewStatus>
      )}
    </PreviewPanelShell>
  );
}

function EntityMentioningPages({ readableId }: { readableId: string }) {
  const query = useInfiniteQuery(entityPagesQueryOptions({ entityReadableId: readableId }));
  const pages = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section className="grid gap-2" aria-label="Mentioned in">
      <h3 className="font-semibold">Mentioned in</h3>
      {query.isPending ? (
        <PreviewStatus>Loading pages…</PreviewStatus>
      ) : query.isError && !query.data ? (
        <PreviewError error={query.error} retry={query.refetch} />
      ) : (
        <>
          {pages.length === 0 ? (
            <PreviewStatus>No pages mention this entity yet.</PreviewStatus>
          ) : (
            <RelatedPageList
              pages={pages}
              renderPage={(page) => <KnowledgePageLink page={page} presentation="card" />}
            />
          )}
          <InfiniteScrollTrigger
            hasNextPage={query.hasNextPage}
            isFetchingNextPage={query.isFetchingNextPage}
            error={query.error}
            loadMore={
              query.isError && !query.isFetchNextPageError ? query.refetch : query.fetchNextPage
            }
          />
        </>
      )}
    </section>
  );
}

export function ResourcePreviewPanel({
  selection,
  onExpand,
  onClose,
}: {
  selection: ResourceSelection;
  onExpand: () => void;
  onClose: () => void;
}) {
  const Preview = previewComponents[selection.kind];
  return (
    <Preview
      key={`${selection.kind}:${selection.readableId}`}
      readableId={selection.readableId}
      publicationStatus={<PreviewPublicationStatus selection={selection} />}
      onClose={onClose}
      onExpand={onExpand}
    />
  );
}

function AssetPreview({ readableId, publicationStatus, onClose, onExpand }: PreviewProps) {
  const { data: asset, error, refetch } = useAssetPreview(readableId);
  return (
    <PreviewPanelShell
      label="Asset"
      publicationStatus={
        asset?.archivedAt ? (
          <ArchivedStatus archivedAt={asset.archivedAt} />
        ) : asset ? (
          publicationStatus
        ) : null
      }
      onClose={onClose}
      onExpand={onExpand}
    >
      {error ? (
        <PreviewError error={error} retry={refetch} />
      ) : asset ? (
        <AssetPreviewContent asset={asset} heading="h2">
          <AssetMedia asset={asset} className="max-h-96 w-full rounded-lg object-contain" />
          <AssetFileActions readableId={asset.readableId} includeArchived={!!asset.archivedAt} />
        </AssetPreviewContent>
      ) : (
        <PreviewStatus>Loading asset…</PreviewStatus>
      )}
    </PreviewPanelShell>
  );
}

function RecordPreview({ readableId, publicationStatus, onClose, onExpand }: PreviewProps) {
  const { data: record, error, refetch } = useRecord(readableId);
  return (
    <PreviewPanelShell
      label="Record"
      publicationStatus={publicationStatus}
      onClose={onClose}
      onExpand={onExpand}
    >
      {error ? (
        <PreviewError error={error} retry={refetch} />
      ) : record ? (
        <div className="grid gap-4">
          <h2 className="font-semibold text-2xl">{record.title}</h2>
          <p className="text-muted-foreground text-sm">
            {record.source.provider} · {record.source.kind}
          </p>
          <ContextRecordMarkdown markdown={record.body} label={record.title} />
          {record.backlinks.length > 0 && (
            <section className="grid gap-2 border-t pt-4">
              <h3 className="font-semibold">Referenced by</h3>
              <RelatedPageList
                pages={record.backlinks}
                renderPage={(page) => <KnowledgePageLink page={page} presentation="card" />}
              />
            </section>
          )}
        </div>
      ) : (
        <PreviewStatus>Loading record…</PreviewStatus>
      )}
    </PreviewPanelShell>
  );
}

const previewComponents = {
  entity: EntityPreview,
  page: PagePreview,
  asset: AssetPreview,
  record: RecordPreview,
};

function PreviewPublicationStatus({ selection }: { selection: ResourceSelection }) {
  const publication = useQuery(
    publicationStatusQueryOptions({
      resourceType: selection.kind,
      readableId: selection.readableId,
    }),
  );
  return <PublicationStatus query={publication} showPublic />;
}
