import { cn } from '@repo/ui/class-names';
import { type ReactNode, useState } from 'react';
import { assetTypeLabel, isEmbeddableAsset } from '../../lib/asset-presentation';
import { useArchiveAsset } from '../../lib/hooks/use-archive-asset';
import { useAsset } from '../../lib/hooks/use-assets';
import { useUpdateAsset } from '../../lib/hooks/use-update-asset';
import type { Asset } from '../../queries/assets';
import { formatAssetSize } from '../assets/asset-link';
import { AssetMedia } from '../assets/asset-media';
import { EntityLink } from '../entities/entity-link';
import { AssetFaces } from '../faces/asset-faces';
import { DetailHeader, DetailShell } from '../knowledge/detail-shell';
import { ResourceArchiveAction } from '../knowledge/resource-archive-action';
import { ResourceDetailActions } from '../knowledge/resource-detail-actions';
import { ResourceDetailHeading } from '../knowledge/resource-detail-heading';
import { ResourceList } from '../knowledge/resource-list';
import { ResourceName, ResourceNameInput } from '../knowledge/resource-name';
import { WorkspaceResourceError } from '../knowledge/workspace-resource-error';
import { KnowledgePageLink } from '../pages/knowledge-page-link';
import { RecordLink } from '../records/record-link';
import { Badge } from '../ui/badge';
import { FieldError } from '../ui/field';
import { AssetFileActions } from './asset-file-actions';

const ASSET_EDIT_FORM_ID = 'asset-edit-form';

function AssetUsageList({
  asset,
  presentation,
}: {
  asset: Asset;
  presentation: 'embed' | 'attachment';
}) {
  const usages = asset.usages.filter(
    (usage): usage is Extract<Asset['usages'][number], { kind: 'page' | 'record' }> =>
      usage.kind !== 'entity_image' && usage.presentation === presentation,
  );
  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="font-semibold text-lg">
          {presentation === 'embed' ? 'Embedded in' : 'Attached to'}
        </h2>
        <Badge variant="secondary">{usages.length}</Badge>
      </div>
      {usages.length > 0 ? (
        <ResourceList>
          {usages.map((usage) =>
            usage.kind === 'page' ? (
              <li key={`page:${usage.page.readableId}`}>
                <KnowledgePageLink page={usage.page} presentation="card" />
              </li>
            ) : (
              <li key={`record:${usage.record.readableId}`}>
                <RecordLink record={usage.record} presentation="card" />
              </li>
            ),
          )}
        </ResourceList>
      ) : (
        <p className="text-muted-foreground text-sm">None yet.</p>
      )}
    </section>
  );
}

function AssetEntityImageUsageList({ asset }: { asset: Asset }) {
  const usages = asset.usages.filter(
    (usage): usage is Extract<Asset['usages'][number], { kind: 'entity_image' }> =>
      usage.kind === 'entity_image',
  );
  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="font-semibold text-lg">Used as image by</h2>
        <Badge variant="secondary">{usages.length}</Badge>
      </div>
      {usages.length > 0 ? (
        <ResourceList>
          {usages.map(({ entity }) => (
            <li key={entity.readableId}>
              <EntityLink entity={{ ...entity, image: asset }} presentation="card" />
            </li>
          ))}
        </ResourceList>
      ) : (
        <p className="text-muted-foreground text-sm">None yet.</p>
      )}
    </section>
  );
}

function AssetPreview({
  asset,
  children,
  processAction,
}: {
  asset: Asset;
  children: ReactNode;
  processAction?: ReactNode;
}) {
  return (
    <section className="grid gap-5 rounded-xl bg-muted p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
      {children}
      <div className="grid gap-4 md:min-w-56">
        <dl className="grid gap-2 text-sm">
          <div>
            <dt className="text-muted-foreground">Type</dt>
            <dd>{assetTypeLabel(asset)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Size</dt>
            <dd>{formatAssetSize(asset.sizeBytes)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Address</dt>
            <dd className="font-mono text-xs">{asset.readableId}</dd>
          </div>
        </dl>
        {processAction}
        <AssetFileActions readableId={asset.readableId} />
      </div>
    </section>
  );
}

export function AssetDetail({ id, onArchived }: { id: string; onArchived: () => void }) {
  const { data: asset, error, refetch } = useAsset(id);
  const updateAsset = useUpdateAsset();
  const archiveAsset = useArchiveAsset();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [archiveConflictVisible, setArchiveConflictVisible] = useState(false);

  if (error) {
    return <WorkspaceResourceError resource="asset" error={error} retry={() => void refetch()} />;
  }
  if (!asset) {
    return (
      <p className="p-8 text-muted-foreground text-sm" role="status">
        Loading asset…
      </p>
    );
  }
  const hasInboundUsages = asset.usages.length > 0;
  const isImage = isEmbeddableAsset(asset);

  return (
    <DetailShell>
      <DetailHeader>
        <ResourceDetailHeading
          actions={
            editing ? (
              <ResourceDetailActions
                mode="edit"
                resource="asset"
                form={ASSET_EDIT_FORM_ID}
                pending={updateAsset.isPending}
                onCancel={() => {
                  updateAsset.reset();
                  setEditing(false);
                }}
              />
            ) : (
              <ResourceDetailActions
                mode="view"
                resource="asset"
                onEdit={() => {
                  setName(asset.name);
                  updateAsset.reset();
                  setArchiveConflictVisible(false);
                  setEditing(true);
                }}
              >
                <ResourceArchiveAction
                  blocked={hasInboundUsages}
                  pending={archiveAsset.isPending}
                  resource="asset"
                  onBlocked={() => {
                    setArchiveConflictVisible(true);
                  }}
                  onConfirm={() => {
                    archiveAsset.mutate(
                      { readableId: asset.readableId },
                      {
                        onSuccess: (result) => {
                          if (result.state === 'archived') {
                            onArchived();
                          } else {
                            setArchiveConflictVisible(true);
                          }
                        },
                      },
                    );
                  }}
                />
              </ResourceDetailActions>
            )
          }
        >
          Asset
        </ResourceDetailHeading>
        {editing ? (
          <form
            className="w-full min-w-0 max-w-3xl"
            id={ASSET_EDIT_FORM_ID}
            onSubmit={(event) => {
              event.preventDefault();
              updateAsset.mutate(
                { readableId: asset.readableId, body: { name: name.trim() } },
                { onSuccess: () => setEditing(false) },
              );
            }}
          >
            <ResourceNameInput
              value={name}
              required
              onChange={(event) => setName(event.target.value)}
              aria-label="Asset name"
            />
          </form>
        ) : (
          <ResourceName>{asset.name}</ResourceName>
        )}
        {updateAsset.error && <FieldError>{updateAsset.error.message}</FieldError>}
      </DetailHeader>

      {archiveAsset.error && <FieldError>{archiveAsset.error.message}</FieldError>}
      {archiveConflictVisible && (
        <p className="text-destructive text-sm" role="alert">
          This asset can’t be archived until every embed, attachment, and entity image is removed or
          replaced.{' '}
          <a className="font-medium underline" href="#used-by">
            Review usages
          </a>
          .
        </p>
      )}

      {isImage ? (
        <AssetFaces asset={asset}>
          {({ preview, processAction }) => (
            <AssetPreview asset={asset} processAction={processAction}>
              {preview}
            </AssetPreview>
          )}
        </AssetFaces>
      ) : (
        <AssetPreview asset={asset}>
          <AssetMedia
            asset={asset}
            className="max-h-[28rem] w-full rounded-lg bg-background object-contain"
          />
        </AssetPreview>
      )}

      <div
        className={cn('grid scroll-mt-24 gap-8', isImage ? 'md:grid-cols-3' : 'md:grid-cols-2')}
        id="used-by"
        tabIndex={-1}
      >
        <AssetUsageList asset={asset} presentation="embed" />
        <AssetUsageList asset={asset} presentation="attachment" />
        {isImage && <AssetEntityImageUsageList asset={asset} />}
      </div>
    </DetailShell>
  );
}
