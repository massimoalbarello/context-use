import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Card, CardContent } from '../components/ui/card';
import { passkeyOriginsQueryOptions } from '../queries/passkeys';

export const Route = createFileRoute('/app/settings/passkeys')({
  loader: ({ context }) => context.queryClient.ensureQueryData(passkeyOriginsQueryOptions),
  component: PasskeySettings,
});

function PasskeySettings() {
  const { data } = useSuspenseQuery(passkeyOriginsQueryOptions);

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-10 px-5 py-10 md:px-10 md:py-12">
      <header>
        <h1 className="font-semibold text-3xl tracking-tight">Passkeys</h1>
      </header>

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
        {data.origins.length > 0 ? (
          <ul className="grid gap-4">
            {data.origins.map((origin) => (
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
