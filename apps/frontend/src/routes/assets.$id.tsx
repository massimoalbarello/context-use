import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { ExternalLink, File } from 'lucide-react';
import { useState } from 'react';
import { formatAssetSize } from '../components/assets/asset-link';
import { EntityLink } from '../components/entities/entity-link';
import { DetailHeader, DetailShell } from '../components/knowledge/detail-shell';
import { ResourceArchiveAction } from '../components/knowledge/resource-archive-action';
import { ResourceDetailActions } from '../components/knowledge/resource-detail-actions';
import { ResourceDetailHeading } from '../components/knowledge/resource-detail-heading';
import { ResourceList } from '../components/knowledge/resource-list';
import { ResourceName, ResourceNameInput } from '../components/knowledge/resource-name';
import { WorkspaceResourceError } from '../components/knowledge/workspace-resource-error';
import { KnowledgePageLink } from '../components/pages/knowledge-page-link';
import { Badge } from '../components/ui/badge';
import { buttonVariants } from '../components/ui/button';
import { FieldError } from '../components/ui/field';
import { assetContentUrl, assetDownloadUrl, isEmbeddableAsset } from '../lib/asset-presentation';
import { useArchiveAsset } from '../lib/hooks/use-archive-asset';
import { useAsset } from '../lib/hooks/use-assets';
import { useUpdateAsset } from '../lib/hooks/use-update-asset';
import { type Asset, assetQueryOptions } from '../queries/assets';

export const Route = createFileRoute('/assets/$id')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(assetQueryOptions(params.id)),
  errorComponent: AssetRouteError,
  component: AssetRoute,
});

const ASSET_EDIT_FORM_ID = 'asset-edit-form';

function AssetRouteError({ error, reset }: ErrorComponentProps) {
  return <WorkspaceResourceError resource="asset" error={error} retry={reset} />;
}

function AssetUsageList({
  asset,
  presentation,
}: {
  asset: Asset;
  presentation: 'embed' | 'attachment';
}) {
  const usages = asset.usages.filter(
    (usage): usage is Extract<Asset['usages'][number], { kind: 'page' }> =>
      usage.kind === 'page' && usage.presentation === presentation,
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
          {usages.map(({ page }) => (
            <li key={page.readableId}>
              <KnowledgePageLink page={page} presentation="card" />
            </li>
          ))}
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
              <EntityLink entity={entity} presentation="card" />
            </li>
          ))}
        </ResourceList>
      ) : (
        <p className="text-muted-foreground text-sm">None yet.</p>
      )}
    </section>
  );
}

function AssetRoute() {
  const { id } = Route.useParams();
  return <AssetRouteContent key={id} id={id} />;
}

function AssetRouteContent({ id }: { id: string }) {
  const navigate = Route.useNavigate();
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
    return null;
  }
  const hasInboundUsages = asset.usages.length > 0;
  const contentUrl = assetContentUrl(asset.readableId);
  const downloadUrl = assetDownloadUrl(asset.readableId);

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
                            void navigate({ to: '/assets' });
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

      <section className="grid gap-5 rounded-xl bg-muted p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        {isEmbeddableAsset(asset) ? (
          <img
            className="max-h-[28rem] w-full rounded-lg bg-background object-contain"
            src={contentUrl}
            alt={asset.name}
          />
        ) : (
          <div className="flex min-h-48 items-center justify-center rounded-lg bg-background text-muted-foreground">
            <File className="size-14 stroke-[1.2]" aria-hidden="true" />
          </div>
        )}
        <div className="grid gap-4 md:min-w-56">
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Type</dt>
              <dd>{asset.mediaType}</dd>
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
          <a className={buttonVariants({ variant: 'outline' })} href={downloadUrl} download>
            Download
          </a>
          <a
            className={buttonVariants({ variant: 'link' })}
            href={contentUrl}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink aria-hidden="true" />
            Open asset page
          </a>
        </div>
      </section>

      <div className="grid scroll-mt-24 gap-8 md:grid-cols-3" id="used-by" tabIndex={-1}>
        <AssetUsageList asset={asset} presentation="embed" />
        <AssetUsageList asset={asset} presentation="attachment" />
        <AssetEntityImageUsageList asset={asset} />
      </div>
    </DetailShell>
  );
}
