import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/domain')({
  component: CustomDomainSettings,
});

function CustomDomainSettings() {
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-8 px-5 py-10 md:px-10 md:py-12">
      <header className="grid gap-3">
        <h1 className="font-semibold text-3xl tracking-tight">Custom domain</h1>
        <p className="max-w-2xl text-muted-foreground">
          Configure the public URL of your Context Use instance.
        </p>
      </header>
      <div className="grid max-w-2xl gap-4 text-muted-foreground text-sm leading-relaxed">
        <p>
          Set the <code>BASE_URL</code> environment variable to your full custom domain URL,
          including
          <code> https://</code>, then restart Context Use.
        </p>
        <code className="wrap-anywhere rounded-lg bg-muted p-3 text-foreground">
          BASE_URL=https://context.example.com
        </code>
        <p>
          Keep the original sign-in domain available for existing passkeys. If a passkey does not
          work on the new domain, sign in at the original address.
        </p>
        <p>
          Update your MCP clients to use the new server URL shown in Settings → MCP and authorize
          them again.
        </p>
      </div>
    </div>
  );
}
