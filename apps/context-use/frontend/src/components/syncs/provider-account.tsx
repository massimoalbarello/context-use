import { Button } from '@repo/ui/button';
import type { SyncProvider } from '../../queries/managed-syncs';
import { ResourceDetailHeading } from '../knowledge/resource-detail-heading';

export function ProviderAccount(input: {
  provider: SyncProvider;
  pending: boolean;
  authorizationFailed: boolean;
  onConnect: () => void;
}) {
  const { provider } = input;
  return (
    <section aria-label="Account" className="grid gap-5">
      <ResourceDetailHeading
        actions={
          provider.oauthApp.configured &&
          (provider.account.status === 'disconnected' ? (
            <Button size="lg" disabled={input.pending} onClick={input.onConnect}>
              Connect account
            </Button>
          ) : provider.syncs.some((sync) => sync.state === 'disconnected') ? (
            <Button size="lg" disabled={input.pending} onClick={input.onConnect}>
              Start sync
            </Button>
          ) : null)
        }
      >
        Account
      </ResourceDetailHeading>
      {input.authorizationFailed && (
        <p role="alert" className="text-destructive text-sm">
          Authorization did not finish. Check your OAuth app settings or try connecting again.
        </p>
      )}
      {provider.account.name && (
        <p>
          {provider.account.status === 'connected' ? 'Connected as' : 'Account:'}{' '}
          <strong>{provider.account.name}</strong>
        </p>
      )}
      {provider.account.status === 'error' && (
        <p role="alert" className="text-destructive text-sm">
          Account access needs attention. Check your authorization on {provider.name}.
        </p>
      )}
      {!provider.oauthApp.configured && (
        <p className="text-muted-foreground">Set up your OAuth app first.</p>
      )}
    </section>
  );
}
