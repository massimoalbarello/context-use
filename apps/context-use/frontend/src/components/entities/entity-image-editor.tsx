import { Button } from '@repo/ui/button';
import { useState } from 'react';
import { MAX_ASSET_BYTES, MAX_ASSET_MEBIBYTES } from '#backend/models/assets/model.ts';
import { DuplicateResourceNameError } from '../../lib/api-error';
import { useCreateAsset } from '../../lib/hooks/use-create-asset';
import { useRemoveEntityImage, useSetEntityImage } from '../../lib/hooks/use-entity-image';
import type { EntityDetail } from '../../queries/entities';
import { FieldError } from '../ui/field';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { createEntityImageAsset } from './entity-image-asset';
import { EntityImagePicker, EntityImageUploadField } from './entity-image-inputs';
import { EntityAvatar } from './entity-link';

export function EntityImageEditor({
  entity,
  isPublic,
  onDone,
}: {
  entity: Pick<EntityDetail, 'readableId' | 'name' | 'image'>;
  isPublic: boolean;
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
            {isPublic ? (
              <>
                Choose an existing public image. To use a new image, add and publish it in{' '}
                <a className="underline" href="/app/assets" target="_blank" rel="noreferrer">
                  Assets (opens in a new tab)
                </a>{' '}
                first. Choosing or removing an image updates the public entity immediately.
              </>
            ) : (
              'Choose an available image asset or upload a new one.'
            )}
          </p>
        </div>
      </div>

      {isPublic ? (
        <EntityImagePicker
          visibility="public"
          selectedImageReadableId={entity.image?.readableId}
          pending={pending}
          onSelect={(asset) => assign(asset.readableId)}
        />
      ) : (
        <Tabs value={source} onValueChange={setSource}>
          <TabsList variant="line" aria-label="Entity image source">
            <TabsTrigger value="existing">Choose existing</TabsTrigger>
            <TabsTrigger value="upload">Upload new</TabsTrigger>
          </TabsList>
          <TabsContent value="existing">
            <EntityImagePicker
              selectedImageReadableId={entity.image?.readableId}
              pending={pending}
              onSelect={(asset) => assign(asset.readableId)}
            />
          </TabsContent>
          <TabsContent value="upload" className="pt-4">
            <EntityImageUploadField
              file={file}
              pending={pending}
              onChange={(file) => {
                setFile(file);
                setValidationError(null);
                createAsset.reset();
              }}
            />
          </TabsContent>
        </Tabs>
      )}

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
