import { buttonVariants } from '@repo/ui/button';
import { cn } from '@repo/ui/class-names';
import { useState } from 'react';
import { EMBEDDABLE_ASSET_MEDIA_TYPES } from '#backend/models/assets/media.ts';
import { MAX_ASSET_MEBIBYTES } from '#backend/models/assets/model.ts';
import { useImageAssetSuggestions } from '../../lib/hooks/use-assets';
import type { AssetSummary } from '../../queries/assets';
import { AssetCardContent } from '../assets/asset-link';
import { ResourceList, resourceCardVariants } from '../knowledge/resource-list';
import { Field, FieldDescription, FieldError, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';

const IMAGE_ACCEPT = EMBEDDABLE_ASSET_MEDIA_TYPES.join(',');

export function EntityImagePicker({
  selectedImageReadableId,
  pending,
  onSelect,
}: {
  selectedImageReadableId?: string;
  pending: boolean;
  onSelect: (asset: AssetSummary) => void;
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
                className={cn(
                  resourceCardVariants(),
                  'w-full text-left transition aria-pressed:border-foreground/35 aria-pressed:bg-card',
                )}
                type="button"
                disabled={pending}
                aria-pressed={selectedImageReadableId === asset.readableId}
                onClick={() => onSelect(asset)}
              >
                <AssetCardContent asset={asset} />
                {selectedImageReadableId === asset.readableId && (
                  <span className="text-sm">Selected</span>
                )}
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

export function EntityImageUploadField({
  file,
  pending,
  onChange,
}: {
  file: File | null;
  pending: boolean;
  onChange: (file: File | null) => void;
}) {
  return (
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
            onChange(event.target.files?.[0] ?? null);
            event.target.value = '';
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
  );
}
