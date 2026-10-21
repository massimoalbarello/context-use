import { getAuthenticatorName, type Passkey } from '@better-auth/passkey';
import { Button } from '@repo/ui/button';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { ResourceDetailActions } from '../components/knowledge/resource-detail-actions';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../components/ui/alert-dialog';
import { Card, CardContent } from '../components/ui/card';
import { Field, FieldError, FieldLabel } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { submitThenChangeValidation } from '../lib/form-validation';
import {
  addPasskey,
  deletePasskey,
  passkeyOriginsQueryOptions,
  updatePasskey,
  userPasskeysQueryKey,
  userPasskeysQueryOptions,
} from '../queries/passkeys';

export const Route = createFileRoute('/app/settings/passkeys')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(passkeyOriginsQueryOptions),
      context.queryClient.ensureQueryData(userPasskeysQueryOptions),
    ]),
  component: PasskeySettings,
});

function PasskeySettings() {
  const { data: origins } = useSuspenseQuery(passkeyOriginsQueryOptions);
  const { data: passkeys } = useSuspenseQuery(userPasskeysQueryOptions);
  const [adding, setAdding] = useState(false);
  const queryClient = useQueryClient();
  const add = useMutation({
    mutationFn: addPasskey,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: userPasskeysQueryKey });
      setAdding(false);
    },
  });
  const remove = useMutation({
    mutationFn: deletePasskey,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userPasskeysQueryKey }),
  });

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-10 px-5 py-10 md:px-10 md:py-12">
      <header>
        <h1 className="font-semibold text-3xl tracking-tight">Passkeys</h1>
      </header>

      <section className="grid gap-4" aria-labelledby="registered-passkeys-heading">
        <div className="grid gap-1">
          <div className="flex items-center justify-between gap-4">
            <h2 id="registered-passkeys-heading" className="font-semibold text-xl">
              Registered passkeys
            </h2>
            {!adding && (
              <Button
                type="button"
                size="lg"
                onClick={() => {
                  add.reset();
                  setAdding(true);
                }}
              >
                <Plus data-icon="inline-start" aria-hidden="true" />
                Add passkey
              </Button>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            Add a passkey on another device so you can use it to sign in to this Context Use
            instance.
          </p>
        </div>
        {adding && (
          <PasskeyNameForm
            name=""
            pending={add.isPending}
            error={add.error}
            onSubmit={(name) => add.mutate(name)}
          >
            <Button
              type="button"
              size="lg"
              variant="outline"
              disabled={add.isPending}
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="lg" disabled={add.isPending}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              {add.isPending ? 'Adding…' : 'Add passkey'}
            </Button>
          </PasskeyNameForm>
        )}
        {passkeys.length > 0 ? (
          <ul className="grid gap-4">
            {passkeys.map((passkey) => (
              <li key={passkey.id}>
                <PasskeyCard
                  passkey={passkey}
                  canRemove={passkeys.length > 1}
                  removing={remove.isPending && remove.variables === passkey.id}
                  onRemove={() => remove.mutate(passkey.id)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No passkeys are registered.</p>
        )}
        {remove.error && (
          <p role="alert" className="text-destructive text-sm">
            {remove.error.message}
          </p>
        )}
      </section>

      <section className="grid gap-4" aria-labelledby="passkey-origins-heading">
        <div className="grid gap-1">
          <h2 id="passkey-origins-heading" className="font-semibold text-xl">
            Known origins
          </h2>
          <p className="text-muted-foreground text-sm">
            These are the domains where passkey sign-in is allowed. To update the list, set{' '}
            <code>BASE_URL</code> to your domain’s full HTTPS URL and restart Context Use.
          </p>
        </div>
        {origins.origins.length > 0 ? (
          <ul className="grid gap-4">
            {origins.origins.map((origin) => (
              <li key={origin}>
                <Card>
                  <CardContent className="wrap-anywhere font-mono text-sm">{origin}</CardContent>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No passkey origins are configured.</p>
        )}
      </section>
    </div>
  );
}

function PasskeyNameForm({
  name,
  pending,
  error,
  onSubmit,
  children,
}: {
  name: string;
  pending: boolean;
  error: Error | null;
  onSubmit: (name: string) => void;
  children: ReactNode;
}) {
  const nameInputId = useId();
  const form = useForm({
    defaultValues: { name },
    validationLogic: submitThenChangeValidation,
    onSubmit: ({ value }) => onSubmit(value.name.trim()),
  });

  return (
    <form
      className="grid w-full gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <form.Field
          name="name"
          validators={{
            onDynamic: ({ value }) => (value.trim() ? undefined : 'Enter a name for this passkey.'),
          }}
        >
          {(field) => (
            <Field className="min-w-0 flex-1" data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={nameInputId}>Passkey name</FieldLabel>
              <Input
                id={nameInputId}
                name={field.name}
                placeholder="Laptop"
                value={field.state.value}
                disabled={pending}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
              />
              <FieldError>{field.state.meta.errors[0]}</FieldError>
            </Field>
          )}
        </form.Field>
        <div className="flex flex-wrap gap-2">{children}</div>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error.message}
        </p>
      )}
    </form>
  );
}

function PasskeyCard({
  passkey,
  canRemove,
  removing,
  onRemove,
}: {
  passkey: Passkey;
  canRemove: boolean;
  removing: boolean;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();
  const rename = useMutation({
    mutationFn: updatePasskey,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: userPasskeysQueryKey });
      setEditing(false);
    },
  });
  const name = passkey.name || getAuthenticatorName(passkey.aaguid) || 'Passkey';

  return (
    <Card>
      <CardContent>
        {editing ? (
          <PasskeyNameForm
            name={name}
            pending={rename.isPending}
            error={rename.error}
            onSubmit={(name) => rename.mutate({ id: passkey.id, name })}
          >
            <ResourceDetailActions
              mode="edit"
              resource="passkey"
              pending={rename.isPending}
              onCancel={() => setEditing(false)}
            />
          </PasskeyNameForm>
        ) : (
          <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
            <div className="min-w-0">
              <strong>{name}</strong>
              <p className="mt-1 text-muted-foreground text-sm">
                Added{' '}
                <time dateTime={new Date(passkey.createdAt).toISOString()}>
                  {new Date(passkey.createdAt).toLocaleString()}
                </time>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ResourceDetailActions
                mode="view"
                resource="passkey"
                onEdit={() => {
                  rename.reset();
                  setEditing(true);
                }}
              >
                {canRemove && (
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button type="button" variant="destructive" size="lg" disabled={removing}>
                          {removing ? 'Removing…' : 'Remove'}
                        </Button>
                      }
                    />
                    <AlertDialogContent>
                      <AlertDialogTitle>Remove {name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This passkey will no longer be able to sign in to this Context Use instance.
                      </AlertDialogDescription>
                      <AlertDialogFooter>
                        <AlertDialogClose
                          render={
                            <Button variant="outline" disabled={removing}>
                              Cancel
                            </Button>
                          }
                        />
                        <AlertDialogClose
                          render={
                            <Button variant="destructive" disabled={removing} onClick={onRemove}>
                              Remove passkey
                            </Button>
                          }
                        />
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </ResourceDetailActions>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
