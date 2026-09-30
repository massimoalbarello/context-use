import { Button } from '@repo/ui/button';
import { useState } from 'react';
import type { OAuthAppCredentials, SyncProvider } from '../../queries/managed-syncs';
import { ResourceDetailActions } from '../knowledge/resource-detail-actions';
import { ResourceDetailHeading } from '../knowledge/resource-detail-heading';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { ManagedSyncCard } from './managed-sync-card';
import { OAuthAppSetup } from './oauth-app-setup';
import { ProviderAccount } from './provider-account';

export type SyncProviderTab = 'sync' | 'authorization';
export function ProviderDetail(input: {
  provider: SyncProvider;
  tab: SyncProviderTab;
  onTabChange: (tab: SyncProviderTab) => void;
  onConnect: () => void;
  onSaveApp: (credentials: OAuthAppCredentials) => Promise<void>;
  onAction: (input: { key: string; action: 'pause' | 'resume' | 'run' }) => void;
  pending: boolean;
  error: Error | null;
  appError: Error | null;
  authorizationFailed: boolean;
}) {
  const { provider } = input;
  return (
    <div className="grid gap-7">
      <header className="grid gap-2">
        <h1 className="font-semibold text-3xl tracking-tight">{provider.name}</h1>
      </header>
      <Tabs
        value={input.tab}
        onValueChange={(value) => {
          if (value === 'sync' || value === 'authorization') {
            input.onTabChange(value);
          }
        }}
      >
        <TabsList variant="line" className="gap-5" aria-label={`${provider.name} settings`}>
          <TabsTrigger value="sync">Sync</TabsTrigger>
          <TabsTrigger value="authorization">Authorization</TabsTrigger>
        </TabsList>
        <TabsContent value="sync" className="pt-7">
          <div className="grid gap-8">
            {!provider.oauthApp.configured || provider.account.status === 'disconnected' ? (
              <div className="grid justify-items-start gap-4">
                <Button variant="outline" onClick={() => input.onTabChange('authorization')}>
                  {provider.oauthApp.configured ? 'Connect account' : 'Set up OAuth app'}
                </Button>
              </div>
            ) : (
              provider.syncs.map((sync) => (
                <ManagedSyncCard
                  key={sync.key}
                  sync={sync}
                  pending={input.pending}
                  onAction={(action) => input.onAction({ key: sync.key, action })}
                />
              ))
            )}
          </div>
        </TabsContent>
        <TabsContent value="authorization" className="pt-7">
          <div className="grid gap-10">
            <OAuthAppPanel
              provider={provider}
              pending={input.pending}
              error={input.appError}
              onSave={input.onSaveApp}
            />
            <ProviderAccount
              provider={provider}
              pending={input.pending}
              authorizationFailed={input.authorizationFailed}
              onConnect={input.onConnect}
            />
          </div>
        </TabsContent>
      </Tabs>
      {input.error && (
        <p role="alert" className="text-destructive text-sm">
          {input.error.message}
        </p>
      )}
    </div>
  );
}

function OAuthAppPanel(input: {
  provider: SyncProvider;
  pending: boolean;
  error: Error | null;
  onSave: (credentials: OAuthAppCredentials) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const { provider } = input;
  if (editing) {
    return (
      <OAuthAppSetup
        providerName={provider.name}
        createAppUrl={provider.oauthApp.createAppUrl}
        callbackUrl={provider.oauthApp.callbackUrl}
        configured={provider.oauthApp.configured}
        pending={input.pending}
        error={input.error}
        onCancel={() => setEditing(false)}
        onSave={(credentials) => {
          void input
            .onSave(credentials)
            .then(() => setEditing(false))
            .catch(() => {});
        }}
      />
    );
  }
  return (
    <section aria-label="OAuth app" className="grid gap-5">
      <ResourceDetailHeading
        actions={
          provider.oauthApp.configured ? (
            <ResourceDetailActions
              mode="view"
              resource="OAuth app"
              onEdit={() => setEditing(true)}
            />
          ) : (
            <Button size="lg" onClick={() => setEditing(true)}>
              Set up OAuth app
            </Button>
          )
        }
      >
        OAuth app
      </ResourceDetailHeading>
      {provider.oauthApp.configured && <p className="text-muted-foreground">Configured</p>}
    </section>
  );
}
