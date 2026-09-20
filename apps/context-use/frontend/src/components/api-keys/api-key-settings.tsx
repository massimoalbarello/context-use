import { Button } from '@repo/ui/button';
import { useForm } from '@tanstack/react-form';
import { Plus, RefreshCwOff } from 'lucide-react';
import { useId, useState } from 'react';
import { MAX_API_KEY_NAME_LENGTH } from '#backend/models/api-keys/model.ts';
import { submitThenChangeValidation } from '../../lib/form-validation';
import type { ApiKey, CreatedApiKey } from '../../queries/api-keys';
import { CopyableValue } from '../copyable-value';
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
import { Card, CardContent } from '../ui/card';
import { Field, FieldError, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';

function validateName({ value }: { value: string }): string | undefined {
  const length = value.trim().length;
  if (length === 0) {
    return 'Enter a name for this key.';
  }
  if (length > MAX_API_KEY_NAME_LENGTH) {
    return `Use ${MAX_API_KEY_NAME_LENGTH} characters or fewer.`;
  }
}

export function CreateApiKeyForm({
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
            <FieldLabel htmlFor={nameInputId}>Key name</FieldLabel>
            <Input
              id={nameInputId}
              name={field.name}
              value={field.state.value}
              maxLength={MAX_API_KEY_NAME_LENGTH}
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
          <Plus data-icon="inline-start" aria-hidden="true" />
          {pending ? 'Adding…' : 'Create API key'}
        </Button>
      </div>
    </form>
  );
}

export function NewApiKeyCredential({
  created,
  recordEndpoint,
  onDone,
}: {
  created: CreatedApiKey;
  recordEndpoint: string;
  onDone: () => void;
}) {
  return (
    <Card className="border border-primary/30 bg-primary/5 ring-0">
      <CardContent className="grid gap-5">
        <div className="grid gap-1">
          <h3 className="font-semibold text-lg">Save the API key for {created.key.name}</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Copy these now. The API key won’t be shown again.
          </p>
        </div>
        <CopyableValue label="Record endpoint" value={recordEndpoint} />
        <CopyableValue label="API key" value={created.apiKey} />
        <div>
          <Button type="button" size="lg" onClick={onDone}>
            I saved the key
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ApiKeyCreatedAt({ credential }: { credential: ApiKey }) {
  return (
    <p className="mt-1 text-muted-foreground text-sm">
      Created{' '}
      <time dateTime={credential.createdAt}>{new Date(credential.createdAt).toLocaleString()}</time>
    </p>
  );
}

function RevokeApiKeyAction({
  credential,
  pending,
  onConfirm,
}: {
  credential: ApiKey;
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
        <AlertDialogTitle>Revoke {credential.name}?</AlertDialogTitle>
        <AlertDialogDescription>
          Its API key will stop authorizing requests immediately. Existing records will remain
          available.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline">Cancel</Button>} />
          <AlertDialogClose
            render={
              <Button variant="destructive" onClick={onConfirm}>
                Revoke API key
              </Button>
            }
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ApiKeySettings({
  keys,
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
  keys: ApiKey[];
  created: CreatedApiKey | undefined;
  recordEndpoint: string;
  creating: boolean;
  createError: Error | null;
  revokingReadableId: string | null;
  revokeError: Error | null;
  onCreate: (name: string) => void;
  onResetCreate: () => void;
  onRevoke: (keyReadableId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const authorized = keys.filter((credential) => credential.revokedAt === null);
  const revoked = keys.filter((credential) => credential.revokedAt !== null);

  function closeCreation() {
    onResetCreate();
    setAdding(false);
  }

  return (
    <div className="grid gap-8">
      <section className="grid gap-4" aria-labelledby="authorized-keys-heading">
        <div className="flex items-center justify-between gap-4">
          <h2 id="authorized-keys-heading" className="font-semibold text-xl">
            Active keys
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
              <Plus data-icon="inline-start" aria-hidden="true" />
              Create API key
            </Button>
          )}
        </div>
        {created ? (
          <NewApiKeyCredential
            created={created}
            recordEndpoint={recordEndpoint}
            onDone={closeCreation}
          />
        ) : adding ? (
          <CreateApiKeyForm
            pending={creating}
            error={createError}
            onSubmit={onCreate}
            onCancel={closeCreation}
          />
        ) : null}
        {authorized.length === 0 ? (
          <p className="text-muted-foreground">No active API keys.</p>
        ) : (
          authorized.map((credential) => (
            <Card key={credential.readableId}>
              <CardContent className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
                <div className="min-w-0">
                  <strong>{credential.name}</strong>
                  <ApiKeyCreatedAt credential={credential} />
                </div>
                <RevokeApiKeyAction
                  credential={credential}
                  pending={revokingReadableId === credential.readableId}
                  onConfirm={() => onRevoke(credential.readableId)}
                />
              </CardContent>
            </Card>
          ))
        )}
        {revokeError && <FieldError>{revokeError.message}</FieldError>}
      </section>
      {revoked.length > 0 && (
        <section className="grid gap-4" aria-labelledby="revoked-keys-heading">
          <h2 id="revoked-keys-heading" className="font-semibold text-xl">
            Revoked API keys
          </h2>
          {revoked.map((credential) => (
            <Card key={credential.readableId}>
              <CardContent className="flex items-center justify-between gap-3">
                <div>
                  <strong>{credential.name}</strong>
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
