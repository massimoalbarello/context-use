import { getAuthenticatorName } from '@better-auth/passkey';
import { Button } from '@repo/ui/button';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
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
import {
  addPasskey,
  deletePasskey,
  passkeyOriginsQueryOptions,
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
  const queryClient = useQueryClient();
  const add = useMutation({
    mutationFn: addPasskey,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userPasskeysQueryKey }),
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
            <Button type="button" size="lg" disabled={add.isPending} onClick={() => add.mutate()}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              {add.isPending ? 'Adding…' : 'Add passkey'}
            </Button>
          </div>
          <p className="text-muted-foreground text-sm">
            Add a passkey on another device so you can use it to sign in to this Context Use
            instance.
          </p>
        </div>
        {passkeys.length > 0 ? (
          <ul className="grid gap-4">
            {passkeys.map((passkey) => {
              const name = passkey.name || getAuthenticatorName(passkey.aaguid) || 'Passkey';
              const canRemove = passkeys.length > 1;
              const removing = remove.isPending && remove.variables === passkey.id;

              return (
                <li key={passkey.id}>
                  <Card>
                    <CardContent className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
                      <div className="min-w-0">
                        <strong>{name}</strong>
                        <p className="mt-1 text-muted-foreground text-sm">
                          Added{' '}
                          <time dateTime={new Date(passkey.createdAt).toISOString()}>
                            {new Date(passkey.createdAt).toLocaleString()}
                          </time>
                        </p>
                      </div>
                      {canRemove ? (
                        <AlertDialog>
                          <AlertDialogTrigger
                            render={
                              <Button
                                type="button"
                                variant="destructive"
                                size="lg"
                                disabled={removing}
                              >
                                {removing ? 'Removing…' : 'Remove'}
                              </Button>
                            }
                          />
                          <AlertDialogContent>
                            <AlertDialogTitle>Remove {name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This passkey will no longer be able to sign in to this Context Use
                              instance.
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
                                  <Button
                                    variant="destructive"
                                    disabled={removing}
                                    onClick={() => remove.mutate(passkey.id)}
                                  >
                                    Remove passkey
                                  </Button>
                                }
                              />
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : (
                        <p className="text-muted-foreground text-sm">
                          Add another passkey before removing this one.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground">No passkeys are registered.</p>
        )}
        {(add.error || remove.error) && (
          <p role="alert" className="text-destructive text-sm">
            {(add.error ?? remove.error)?.message}
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
