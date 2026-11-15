export const LOCAL_RECORD_DESTINATION = 'local-records';

export const MANAGED_SYNC_ACTIONS = ['pause', 'resume', 'run', 'resync'] as const;
export type ManagedSyncAction = (typeof MANAGED_SYNC_ACTIONS)[number];

export const MANAGED_SYNC_STATES = [
  'setup-required',
  'disconnected',
  'ready',
  'syncing',
  'paused',
  'error',
] as const;
export type ManagedSyncState = (typeof MANAGED_SYNC_STATES)[number];
export interface ManagedSyncSummary {
  key: string;
  name: string;
  description: string;
  provider: string;
  kinds: string[];
  state: ManagedSyncState;
  lastSyncedAt: string | null;
  message: string;
}

export interface SyncProviderSummary {
  id: string;
  name: string;
  description: string;
  oauthApp: {
    configured: boolean;
    callbackUrl: string;
    createAppUrl: string | null;
    automaticRegistration: boolean;
  };
  account: { name: string | null; status: 'disconnected' | 'connected' | 'error' };
  syncs: ManagedSyncSummary[];
}
