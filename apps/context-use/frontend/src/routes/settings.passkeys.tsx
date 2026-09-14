import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/passkeys')({
  component: PasskeySettings,
});

function PasskeySettings() {
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-8 px-5 py-10 md:px-10 md:py-12">
      <header className="grid gap-3">
        <h1 className="font-semibold text-3xl tracking-tight">Passkeys</h1>
        <p className="max-w-2xl text-muted-foreground">
          This applies only if you set a custom domain for this Context Use instance.
        </p>
      </header>
      <div className="grid max-w-2xl gap-4 text-muted-foreground text-sm leading-relaxed">
        <p>
          To allow passkey sign-in on that domain, set <code>BASE_URL</code> to its full HTTPS URL
          and restart Context Use.
        </p>
        <code className="wrap-anywhere rounded-lg bg-muted p-3 text-foreground">
          BASE_URL=https://context.example.com
        </code>
        <p>If an existing passkey does not work there, sign in at the original address.</p>
      </div>
    </div>
  );
}
