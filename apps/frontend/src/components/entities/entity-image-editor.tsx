import { MAX_ASSET_BYTES, MAX_ASSET_MEBIBYTES } from '@repo/backend/asset';
import { useState } from 'react';
import { DuplicateResourceNameError } from '../../lib/api-error';
import { cn } from '../../lib/class-names';
import { useImageAssetSuggestions } from '../../lib/hooks/use-assets';
import { useCreateAsset } from '../../lib/hooks/use-create-asset';
import { useRemoveEntityImage, useSetEntityImage } from '../../lib/hooks/use-entity-image';
import type { EntityDetail } from '../../queries/entities';
import { AssetCardContent } from '../assets/asset-link';
import { ResourceList, resourceCardVariants } from '../knowledge/resource-list';
import { Button, buttonVariants } from '../ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { createEntityImageAsset } from './entity-image-asset';
import { EntityAvatar } from './entity-link';

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';

function EntityImagePicker({
  selectedImageReadableId,
  pending,
  onSelect,
}: {
  selectedImageReadableId?: string;
  pending: boolean;
  onSelect: (assetReadableId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const suggestions = useImageAssetSuggestions(query);

  return (
    <div className="grid gap-3 pt-4">
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
            <li key={asset.readableId}>
              <button
                className={cn(resourceCardVariants(), 'w-full text-left transition')}
                type="button"
                disabled={pending}
                aria-pressed={selectedImageReadableId === asset.readableId}
                onClick={() => onSelect(asset.readableId)}
              >
                <AssetCardContent asset={asset} />
              </button>
            </li>
          ))}
        </ResourceList>
      ) : (
        <p className="text-muted-foreground text-sm">No available image assets found.</p>
      )}
    </div>
  );
}

export function EntityImageEditor({
  entity,
  onDone,
}: {
  entity: Pick<EntityDetail, 'readableId' | 'name' | 'image'>;
  onDone: () => void;
}) {
  const [source, setSource] = useState('existing');
  const [file, setFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const createAsset = useCreateAsset();
  const setImage = useSetEntityImage();
  const removeImage = useRemoveEntityImage();
  const pending = createAsset.isPending || setImage.isPending || removeImage.isPending;
  const uploadError =
    createAsset.error instanceof DuplicateResourceNameError ? null : createAsset.error;
  const actionError = uploadError ?? setImage.error ?? removeImage.error;

  function assign(assetReadableId: string) {
    setImage.mutate({ readableId: entity.readableId, assetReadableId });
  }

  async function finish() {
    if (source !== 'upload' || !file) {
      onDone();
      return;
    }
    if (file.size > MAX_ASSET_BYTES) {
      setValidationError(`Assets can be at most ${MAX_ASSET_MEBIBYTES} MB.`);
      return;
    }
    setValidationError(null);
    try {
      const asset = await createEntityImageAsset({
        entityName: entity.name,
        file,
        createAsset: createAsset.mutateAsync,
      });
      await setImage.mutateAsync({
        readableId: entity.readableId,
        assetReadableId: asset.readableId,
      });
      onDone();
    } catch {
      // Mutation errors are rendered from their canonical TanStack Query state.
    }
  }

  return (
    <section
      id="entity-image-editor"
      className="grid max-w-3xl gap-5 rounded-xl bg-muted p-5"
      aria-labelledby="entity-image-heading"
    >
      <div className="flex min-w-0 items-center gap-4">
        <EntityAvatar entity={entity} className="size-16 text-xl" />
        <div>
          <h2 className="font-semibold text-lg" id="entity-image-heading">
            Entity image
          </h2>
          <p className="text-muted-foreground text-sm">
            Choose an available image asset or upload a new one.
          </p>
        </div>
      </div>

      <Tabs value={source} onValueChange={setSource}>
        <TabsList variant="line" aria-label="Entity image source">
          <TabsTrigger value="existing">Choose existing</TabsTrigger>
          <TabsTrigger value="upload">Upload new</TabsTrigger>
        </TabsList>
        <TabsContent value="existing">
          <EntityImagePicker
            selectedImageReadableId={entity.image?.readableId}
            pending={pending}
            onSelect={assign}
          />
        </TabsContent>
        <TabsContent value="upload" className="pt-4">
          <Field>
            <FieldLabel htmlFor="entity-image-file">File</FieldLabel>
            <div className="flex flex-wrap items-center gap-3">
              <input
                className="peer sr-only"
                id="entity-image-file"
                type="file"
                accept={IMAGE_ACCEPT}
                disabled={pending}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setValidationError(null);
                  createAsset.reset();
                }}
              />
              <label
                className={buttonVariants({
                  variant: 'outline',
                  size: 'lg',
                  className:
                    'cursor-pointer peer-focus-visible:border-ring peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50',
                })}
                htmlFor="entity-image-file"
              >
                Choose file
              </label>
              <span className="min-w-0 truncate text-muted-foreground text-sm">
                {file?.name ?? 'No file chosen'}
              </span>
            </div>
            <FieldDescription>Up to {MAX_ASSET_MEBIBYTES} MB.</FieldDescription>
          </Field>
        </TabsContent>
      </Tabs>

      {(validationError || actionError) && (
        <FieldError>{validationError ?? actionError?.message}</FieldError>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {entity.image && (
            <Button
              variant="outline"
              type="button"
              disabled={pending}
              onClick={() => {
                setFile(null);
                removeImage.mutate({ readableId: entity.readableId });
              }}
            >
              {removeImage.isPending ? 'Removing…' : 'Remove image'}
            </Button>
          )}
        </div>
        <Button
          variant="outline"
          type="button"
          disabled={pending}
          onClick={() => {
            void finish();
          }}
        >
          {pending ? 'Saving…' : 'Done'}
        </Button>
      </div>
    </section>
  );
}
