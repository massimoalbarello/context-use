import { MAX_SYNC_NAME_LENGTH } from '@repo/backend/sync';
import { useForm } from '@tanstack/react-form';
import { Check, Copy, Recycle, RefreshCwOff } from 'lucide-react';
import { useId, useState } from 'react';
import { submitThenChangeValidation } from '../../lib/form-validation';
import type { CreatedRecordSync, RecordSync } from '../../queries/syncs';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../ui/alert-dialog';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Field, FieldError, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';

type CopyState = 'idle' | 'copied' | 'failed';

function validateName({ value }: { value: string }): string | undefined {
  const length = value.trim().length;
  if (length === 0) {
    return 'Enter a name for this sync.';
  }
  if (length > MAX_SYNC_NAME_LENGTH) {
    return `Use ${MAX_SYNC_NAME_LENGTH} characters or fewer.`;
  }
}

export function CopyableSyncValue({
  label,
  value,
}: {
  label: 'Record endpoint' | 'API key';
  value: string;
}) {
  const [copyState, setCopyState] = useState<CopyState>('idle');

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <Input
          className="font-mono"
          aria-label={label}
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Copy ${label}`}
          onClick={copyValue}
        >
          {copyState === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </Button>
      </div>
      {copyState === 'failed' && (
        <FieldError>
          Could not access the clipboard. Select the value and copy it manually.
        </FieldError>
      )}
      <span className="sr-only" aria-live="polite">
        {copyState === 'copied' ? `${label} copied.` : ''}
      </span>
    </Field>
  );
}

export function CreateSyncForm({
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  pending: boolean;
  error: Error | null;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const nameInputId = useId();
  const form = useForm({
    defaultValues: { name: '' },
    validationLogic: submitThenChangeValidation,
    onSubmit: ({ value }) => onSubmit(value.name.trim()),
  });

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="name" validators={{ onDynamic: validateName }}>
        {(field) => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel htmlFor={nameInputId}>Sync name</FieldLabel>
            <Input
              id={nameInputId}
              name={field.name}
              value={field.state.value}
              maxLength={MAX_SYNC_NAME_LENGTH}
              placeholder="Engineering activity"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              aria-invalid={field.state.meta.errors.length > 0}
            />
            <FieldError>{field.state.meta.errors[0]}</FieldError>
          </Field>
        )}
      </form.Field>
      {error && <FieldError>{error.message}</FieldError>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="lg" variant="outline" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="lg" disabled={pending}>
          <Recycle data-icon="inline-start" aria-hidden="true" />
          {pending ? 'Adding…' : 'Add sync'}
        </Button>
      </div>
    </form>
  );
}

export function NewSyncCredential({
  created,
  recordEndpoint,
  onDone,
}: {
  created: CreatedRecordSync;
  recordEndpoint: string;
  onDone: () => void;
}) {
  return (
    <Card className="border border-primary/30 bg-primary/5 ring-0">
      <CardContent className="grid gap-5">
        <div className="grid gap-1">
          <h3 className="font-semibold text-lg">Save the API key for {created.sync.name}</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Copy these now. The API key won’t be shown again.
          </p>
        </div>
        <CopyableSyncValue label="Record endpoint" value={recordEndpoint} />
        <CopyableSyncValue label="API key" value={created.apiKey} />
        <div>
          <Button type="button" size="lg" onClick={onDone}>
            I saved the key
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SyncCreatedAt({ sync }: { sync: RecordSync }) {
  return (
    <p className="mt-1 text-muted-foreground text-sm">
      Created <time dateTime={sync.createdAt}>{new Date(sync.createdAt).toLocaleString()}</time>
    </p>
  );
}

function RevokeSyncAction({
  sync,
  pending,
  onConfirm,
}: {
  sync: RecordSync;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button variant="destructive" size="lg" type="button" disabled={pending}>
            <RefreshCwOff data-icon="inline-start" aria-hidden="true" />
            {pending ? 'Revoking…' : 'Revoke'}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogTitle>Revoke {sync.name}?</AlertDialogTitle>
        <AlertDialogDescription>
          Its API key will stop authorizing deliveries immediately. Records already received from
          this sync will remain available.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline">Cancel</Button>} />
          <AlertDialogClose
            render={
              <Button variant="destructive" onClick={onConfirm}>
                Revoke sync
              </Button>
            }
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function SyncSettings({
  syncs,
  created,
  recordEndpoint,
  creating,
  createError,
  revokingReadableId,
  revokeError,
  onCreate,
  onResetCreate,
  onRevoke,
}: {
  syncs: RecordSync[];
  created: CreatedRecordSync | undefined;
  recordEndpoint: string;
  creating: boolean;
  createError: Error | null;
  revokingReadableId: string | null;
  revokeError: Error | null;
  onCreate: (name: string) => void;
  onResetCreate: () => void;
  onRevoke: (syncReadableId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const authorized = syncs.filter((sync) => sync.revokedAt === null);
  const revoked = syncs.filter((sync) => sync.revokedAt !== null);

  function closeCreation() {
    onResetCreate();
    setAdding(false);
  }

  return (
    <div className="grid gap-8">
      <section className="grid gap-4" aria-labelledby="authorized-syncs-heading">
        <div className="flex items-center justify-between gap-4">
          <h2 id="authorized-syncs-heading" className="font-semibold text-xl">
            Authorized syncs
          </h2>
          {!adding && !created && (
            <Button
              type="button"
              size="lg"
              onClick={() => {
                onResetCreate();
                setAdding(true);
              }}
            >
              <Recycle data-icon="inline-start" aria-hidden="true" />
              Add sync
            </Button>
          )}
        </div>
        {created ? (
          <NewSyncCredential
            created={created}
            recordEndpoint={recordEndpoint}
            onDone={closeCreation}
          />
        ) : adding ? (
          <CreateSyncForm
            pending={creating}
            error={createError}
            onSubmit={onCreate}
            onCancel={closeCreation}
          />
        ) : null}
        {authorized.length === 0 ? (
          <p className="text-muted-foreground">No authorized syncs.</p>
        ) : (
          authorized.map((sync) => (
            <Card key={sync.readableId}>
              <CardContent className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
                <div className="min-w-0">
                  <strong>{sync.name}</strong>
                  <SyncCreatedAt sync={sync} />
                </div>
                <RevokeSyncAction
                  sync={sync}
                  pending={revokingReadableId === sync.readableId}
                  onConfirm={() => onRevoke(sync.readableId)}
                />
              </CardContent>
            </Card>
          ))
        )}
        {revokeError && <FieldError>{revokeError.message}</FieldError>}
      </section>
      {revoked.length > 0 && (
        <section className="grid gap-4" aria-labelledby="revoked-syncs-heading">
          <h2 id="revoked-syncs-heading" className="font-semibold text-xl">
            Revoked syncs
          </h2>
          {revoked.map((sync) => (
            <Card key={sync.readableId}>
              <CardContent className="flex items-center justify-between gap-3">
                <div>
                  <strong>{sync.name}</strong>
                  <p className="text-muted-foreground text-sm">API key revoked</p>
                </div>
                <Badge variant="secondary">Revoked</Badge>
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
