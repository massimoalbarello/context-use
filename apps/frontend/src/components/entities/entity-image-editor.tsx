import { useState } from 'react';
import { cn } from '../../lib/class-names';
import { useImageAssetSuggestions } from '../../lib/hooks/use-assets';
import { useCreateAsset } from '../../lib/hooks/use-create-asset';
import { useRemoveEntityImage, useSetEntityImage } from '../../lib/hooks/use-entity-image';
import type { EntityDetail } from '../../queries/entities';
import { AssetCardContent } from '../assets/asset-link';
import { AssetUploadForm } from '../assets/asset-upload-form';
import { ResourceList, resourceCardVariants } from '../knowledge/resource-list';
import { Button } from '../ui/button';
import { FieldError } from '../ui/field';
import { Input } from '../ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { EntityAvatar } from './entity-link';

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';

export function EntityImageEditor({
  entity,
  onDone,
}: {
  entity: Pick<EntityDetail, 'readableId' | 'name' | 'image'>;
  onDone: () => void;
}) {
  const [query, setQuery] = useState('');
  const suggestions = useImageAssetSuggestions(query);
  const createAsset = useCreateAsset();
  const setImage = useSetEntityImage();
  const removeImage = useRemoveEntityImage();
  const pending = createAsset.isPending || setImage.isPending || removeImage.isPending;
  const actionError = setImage.error ?? removeImage.error;

  function assign(assetReadableId: string) {
    setImage.mutate({ readableId: entity.readableId, assetReadableId }, { onSuccess: onDone });
  }

  return (
    <section
      className="grid max-w-3xl gap-5 rounded-xl bg-muted p-5"
      aria-labelledby="entity-image-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <EntityAvatar entity={entity} className="size-16 text-xl" />
          <div>
            <h2 className="font-semibold text-lg" id="entity-image-heading">
              Entity image
            </h2>
            <p className="text-muted-foreground text-sm">
              Choose an existing image asset or upload a new one.
            </p>
          </div>
        </div>
        <Button variant="outline" type="button" disabled={pending} onClick={onDone}>
          Done
        </Button>
      </div>

      <Tabs defaultValue="existing">
        <TabsList variant="line" aria-label="Entity image source">
          <TabsTrigger value="existing">Choose existing</TabsTrigger>
          <TabsTrigger value="upload">Upload new</TabsTrigger>
        </TabsList>
        <TabsContent value="existing" className="grid gap-3 pt-4">
          <Input
            value={query}
            placeholder="Search image assets"
            aria-label="Search image assets"
            onChange={(event) => setQuery(event.target.value)}
          />
          {suggestions.isPending ? (
            <p className="text-muted-foreground text-sm">Loading image assets…</p>
          ) : suggestions.error ? (
            <FieldError>{suggestions.error.message}</FieldError>
          ) : suggestions.data && suggestions.data.length > 0 ? (
            <ResourceList className="gap-2">
              {suggestions.data.map((asset) => (
                <li key={asset.id}>
                  <button
                    className={cn(resourceCardVariants(), 'w-full text-left transition')}
                    type="button"
                    disabled={pending}
                    aria-pressed={entity.image?.id === asset.id}
                    onClick={() => assign(asset.readableId)}
                  >
                    <AssetCardContent asset={asset} />
                  </button>
                </li>
              ))}
            </ResourceList>
          ) : (
            <p className="text-muted-foreground text-sm">No image assets found.</p>
          )}
        </TabsContent>
        <TabsContent value="upload" className="pt-4">
          <AssetUploadForm
            accept={IMAGE_ACCEPT}
            pending={pending}
            error={createAsset.error}
            onSubmit={(value) => {
              createAsset.mutate(value, {
                onSuccess: ({ readableId }) => assign(readableId),
              });
            }}
          />
        </TabsContent>
      </Tabs>

      {actionError && <FieldError>{actionError.message}</FieldError>}
      {entity.image && (
        <div>
          <Button
            variant="outline"
            type="button"
            disabled={pending}
            onClick={() => {
              removeImage.mutate({ readableId: entity.readableId }, { onSuccess: onDone });
            }}
          >
            {removeImage.isPending ? 'Removing…' : 'Remove image'}
          </Button>
        </div>
      )}
    </section>
  );
}
