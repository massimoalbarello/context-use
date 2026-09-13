import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { AssetUploadForm } from '../components/assets/asset-upload-form';
import { DetailShell } from '../components/knowledge/detail-shell';
import { useCreateAsset } from '../lib/hooks/use-create-asset';

export const Route = createFileRoute('/assets/new')({ component: NewAssetRoute });

function NewAssetRoute() {
  const navigate = useNavigate();
  const createAsset = useCreateAsset();
  return (
    <DetailShell className="w-full max-w-2xl gap-5">
      <header className="grid gap-1">
        <h1 className="font-semibold text-2xl tracking-tight">Upload asset</h1>
        <p className="text-muted-foreground text-sm">
          The file stays private and gets a stable address derived from its name.
        </p>
      </header>
      <AssetUploadForm
        pending={createAsset.isPending}
        error={createAsset.error}
        onSubmit={(value) =>
          createAsset.mutate(value, {
            onSuccess: async ({ readableId }) =>
              navigate({ to: '/assets/$id', params: { id: readableId } }),
          })
        }
      />
    </DetailShell>
  );
}
