import { createFileRoute } from '@tanstack/react-router';
import { CustomDomainHelp } from '../components/auth/custom-domain-help';

export const Route = createFileRoute('/settings/domain')({
  component: CustomDomainSettings,
});

function CustomDomainSettings() {
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-8 px-5 py-10 md:px-10 md:py-12">
      <header className="grid gap-3">
        <h1 className="font-semibold text-3xl tracking-tight">Custom domain</h1>
        <p className="max-w-2xl text-muted-foreground">
          Change your nibrun app’s address without creating another account or passkey.
        </p>
      </header>
      <div className="max-w-2xl">
        <CustomDomainHelp />
      </div>
    </div>
  );
}
