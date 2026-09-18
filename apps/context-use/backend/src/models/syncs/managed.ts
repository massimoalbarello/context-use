export const LOCAL_RECORD_DESTINATION = 'local-records';

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
  intervalMs: number;
  state: ManagedSyncState;
  recordCount: number;
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  message: string;
}

export interface SyncProviderSummary {
  id: string;
  name: string;
  description: string;
  oauthApp: {
    configured: boolean;
    clientId: string | null;
    callbackUrl: string;
    createAppUrl: string;
  };
  account: { name: string | null; status: 'disconnected' | 'connected' | 'error' };
  syncs: ManagedSyncSummary[];
}
