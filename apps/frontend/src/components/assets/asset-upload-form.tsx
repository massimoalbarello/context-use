import { MAX_ASSET_BYTES, MAX_ASSET_MEBIBYTES, MAX_ASSET_NAME_LENGTH } from '@repo/backend/asset';
import { useState } from 'react';
import { DuplicateResourceNameError } from '../../lib/api-error';
import { Button, buttonVariants } from '../ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';

function suggestedName(file: File): string {
  const dot = file.name.lastIndexOf('.');
  return (dot > 0 ? file.name.slice(0, dot) : file.name).trim();
}

export function AssetUploadForm({
  pending,
  error,
  accept,
  onSubmit,
}: {
  pending: boolean;
  error: Error | null;
  accept?: string;
  onSubmit: (value: { name: string; file: File; allowDuplicate?: boolean }) => void;
}) {
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  function submit(allowDuplicate = false) {
    const trimmedName = name.trim();
    if (!trimmedName || !file) {
      setValidationError('Choose a file and give it a meaningful name.');
      return;
    }
    if (file.size > MAX_ASSET_BYTES) {
      setValidationError(`Assets can be at most ${MAX_ASSET_MEBIBYTES} MB.`);
      return;
    }
    setValidationError(null);
    onSubmit({ name: trimmedName, file, allowDuplicate: allowDuplicate || undefined });
  }

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="asset-file">File</FieldLabel>
          <div className="flex flex-wrap items-center gap-3">
            <input
              className="peer sr-only"
              id="asset-file"
              type="file"
              accept={accept}
              required
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                setFile(selected);
                if (selected && !name.trim()) {
                  setName(suggestedName(selected));
                }
              }}
            />
            <label
              className={buttonVariants({
                variant: 'outline',
                size: 'lg',
                className:
                  'cursor-pointer peer-focus-visible:border-ring peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50',
              })}
              htmlFor="asset-file"
            >
              Choose file
            </label>
            <span className="min-w-0 truncate text-muted-foreground text-sm">
              {file?.name ?? 'No file chosen'}
            </span>
          </div>
          <FieldDescription>Up to {MAX_ASSET_MEBIBYTES} MB.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="asset-name">Name</FieldLabel>
          <Input
            id="asset-name"
            value={name}
            maxLength={MAX_ASSET_NAME_LENGTH}
            required
            onChange={(event) => setName(event.target.value)}
          />
          <FieldDescription>
            Use a specific name; it becomes the asset’s stable Markdown address.
          </FieldDescription>
        </Field>
      </FieldGroup>
      {(validationError || error) && <FieldError>{validationError ?? error?.message}</FieldError>}
      <div className="flex flex-wrap gap-3">
        <Button size="lg" type="submit" disabled={pending}>
          {pending ? 'Uploading…' : 'Upload asset'}
        </Button>
        {error instanceof DuplicateResourceNameError && (
          <Button variant="outline" type="button" disabled={pending} onClick={() => submit(true)}>
            Use this name anyway
          </Button>
        )}
      </div>
    </form>
  );
}
