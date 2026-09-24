import type { OpenSyncRuntime } from '@context-use/open-sync';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { BadRequestError, ForbiddenError, NotFoundError } from '#backend/lib/errors.ts';
import type {
  ManagedSyncState,
  ManagedSyncSummary,
  SyncProviderSummary,
} from '#backend/models/syncs/managed.ts';
import { LOCAL_RECORD_DESTINATION } from '#backend/models/syncs/managed.ts';
import type { ContextSync, SyncCatalog, SyncProvider } from './catalog.ts';

const HEALTHY_STATES = new Set([
  'ready',
  'running',
  'waiting_for_capacity',
  'succeeded',
  'disabled',
]);
type Scope = { actorId: string; ownerId: string };
type Queue = { blocked: string[]; pending: number };
type ConfiguredSync = ReturnType<OpenSyncRuntime['api']['syncs']>[number];

function managedState(input: {
  configured: boolean;
  connected: boolean;
  connectionActive: boolean;
  configuredSync: ConfiguredSync | undefined;
  queue: Queue;
}): { state: ManagedSyncState; message: string } {
  if (!input.configured) {
    return { state: 'setup-required', message: 'Set up your OAuth app to get started.' };
  }
  if (!input.connected || !input.configuredSync) {
    return { state: 'disconnected', message: 'Connect your account to start syncing.' };
  }
  if (!input.configuredSync.enabled) {
    return {
      state: 'paused',
      message: input.configuredSync.errorCode
        ? 'Syncing paused after a provider error. Check your account access before resuming.'
        : 'Automatic syncing is paused. Your records are kept.',
    };
  }
  if (input.queue.blocked.length) {
    return {
      state: 'error',
      message: 'Some records could not be saved. Try syncing again.',
    };
  }
  if (!input.connectionActive || !HEALTHY_STATES.has(input.configuredSync.status)) {
    return { state: 'error', message: 'This sync could not finish. Automatic retries continue.' };
  }
  if (input.queue.pending) {
    return { state: 'syncing', message: 'Saving records…' };
  }
  if (['ready', 'running', 'waiting_for_capacity'].includes(input.configuredSync.status)) {
    return { state: 'syncing', message: 'Checking for changes…' };
  }
  return { state: 'ready', message: 'Up to date. New changes are checked automatically.' };
}

export class ManagedSyncsService {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly input: {
      sync: Pick<OpenSyncRuntime, 'api' | 'providers'>;
      catalog: SyncCatalog;
    },
  ) {}

  private scope(actorId: string): Scope {
    if (actorId !== OWNER_USER_ID) {
      throw new ForbiddenError();
    }
    return { actorId, ownerId: actorId };
  }
  private configuredSync(input: { scope: Scope; sync: ContextSync }) {
    return this.input.sync.api
      .syncs(input.scope)
      .find((item) => item.definition === input.sync.registration.definition.id);
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.pending.then(action, action);
    this.pending = next.catch(() => {});
    return next;
  }
  private queue(input: Scope & { syncId: string }): Queue {
    const queue: Queue = { blocked: [], pending: 0 };
    let before: number | undefined;
    while (true) {
      const page = this.input.sync.api.deliveries({ ...input, before });
      for (const item of page.deliveries) {
        if (item.state === 'blocked') {
          queue.blocked.push(item.id);
        } else {
          queue.pending += item.recordCount;
        }
      }
      if (page.nextCursor === null) {
        return queue;
      }
      before = page.nextCursor;
    }
  }
  async list(input: { actorId: string }): Promise<SyncProviderSummary[]> {
    const scope = this.scope(input.actorId);
    const configuredSyncs = this.input.sync.api.syncs(scope);
    return await Promise.all(
      this.input.catalog.providers.map(async (provider) => {
        const status = await this.input.sync.providers.status({ ...scope, service: provider.id });
        const oauth = status.setup.oauthClient;
        if (!oauth) {
          throw new BadRequestError('OAuth app setup is unavailable.');
        }
        const connection = status.connections[0];
        const syncs = provider.syncs.map((sync): ManagedSyncSummary => {
          const configuredSync = configuredSyncs.find(
            (item) => item.definition === sync.registration.definition.id,
          );
          const bound = status.connections.find(
            (item) => item.id === configuredSync?.connection?.id,
          );
          const polls = configuredSync
            ? this.input.sync.api.polls({ ...scope, id: configuredSync.id }).polls
            : [];
          const lastSuccess = polls.find((poll) => poll.state === 'succeeded');
          return {
            key: sync.registration.definition.id,
            name: sync.name,
            description: sync.description,
            provider: provider.id,
            kinds: Object.keys(sync.registration.definition.kinds),
            intervalMs: sync.intervalMs,
            ...managedState({
              configured: oauth.configured,
              connected: Boolean(connection),
              connectionActive: bound?.status === 'active',
              configuredSync,
              queue: configuredSync
                ? this.queue({ ...scope, syncId: configuredSync.id })
                : { blocked: [], pending: 0 },
            }),
            lastSyncedAt: lastSuccess?.completedAt
              ? new Date(lastSuccess.completedAt).toISOString()
              : null,
            nextSyncAt: configuredSync?.enabled
              ? new Date(configuredSync.nextDueAt).toISOString()
              : null,
          };
        });
        return {
          id: provider.id,
          name: provider.name,
          description: provider.description,
          oauthApp: {
            configured: oauth.configured,
            callbackUrl: oauth.expectedRedirectUri,
            createAppUrl: provider.oauth.createAppUrl,
          },
          account: {
            name: connection?.account ?? null,
            status: connection
              ? connection.status === 'active'
                ? 'connected'
                : 'error'
              : 'disconnected',
          },
          syncs,
        };
      }),
    );
  }
  async configureApp(input: {
    actorId: string;
    providerId: string;
    clientId: string;
    clientSecret: string;
  }) {
    const scope = this.scope(input.actorId);
    const provider = this.input.catalog.provider(input.providerId);
    await this.serial(async () => {
      try {
        await this.input.sync.providers.configure({
          ...scope,
          service: provider.id,
          values: { clientId: input.clientId, clientSecret: input.clientSecret },
        });
      } catch {
        throw new BadRequestError(
          'Could not save your OAuth app. Check the credentials and try again.',
        );
      }
    });
  }
  async connect(input: {
    actorId: string;
    providerId: string;
  }): Promise<{ authorizationUrl: string | null }> {
    const scope = this.scope(input.actorId);
    const provider = this.input.catalog.provider(input.providerId);
    return await this.serial(async () => {
      if (
        (await this.input.sync.providers.connections(scope)).some(
          (connection) => connection.service === provider.id,
        )
      ) {
        await this.activate({ scope, provider });
        return { authorizationUrl: null };
      }
      const status = await this.input.sync.providers.status({ ...scope, service: provider.id });
      if (!status.setup.oauthClient?.configured) {
        throw new BadRequestError('Set up your OAuth app first.');
      }
      return await this.input.sync.providers.start({
        ...scope,
        service: provider.id,
        authorizationOptionIds: provider.oauth.authorizationOptionIds,
      });
    });
  }
  private async activate(input: { scope: Scope; provider: SyncProvider }) {
    const { scope, provider } = input;
    const connection = (await this.input.sync.providers.connections(scope)).find(
      (item) => item.service === provider.id,
    );
    if (!connection) {
      throw new BadRequestError('Connect your account first.');
    }
    for (const sync of provider.syncs) {
      if (this.configuredSync({ scope, sync })) {
        continue;
      }
      await this.input.sync.api.createSync({
        ...scope,
        definition: sync.registration.definition.id,
        connection,
        config: {},
        destination: { type: LOCAL_RECORD_DESTINATION, input: {} },
        intervalMs: sync.intervalMs,
      });
    }
  }
  async completeConnection(input: { actorId: string; providerId: string }) {
    const scope = this.scope(input.actorId);
    const provider = this.input.catalog.provider(input.providerId);
    await this.serial(() => this.activate({ scope, provider }));
  }
  async update(input: { actorId: string; key: string; action: 'pause' | 'resume' | 'run' }) {
    const scope = this.scope(input.actorId);
    const { sync } = this.input.catalog.sync(input.key);
    const configuredSync = this.configuredSync({ scope, sync });
    if (!configuredSync) {
      throw new NotFoundError('Connect your account first.');
    }
    if (input.action === 'run') {
      if (!configuredSync.enabled) {
        throw new BadRequestError('Resume the sync first.');
      }
      for (const id of this.queue({ ...scope, syncId: configuredSync.id }).blocked) {
        this.input.sync.api.retryDelivery({ ...scope, syncId: configuredSync.id, id });
      }
      this.input.sync.api.runNow({ ...scope, id: configuredSync.id });
    } else {
      await this.input.sync.api.setEnabled({
        ...scope,
        id: configuredSync.id,
        enabled: input.action === 'resume',
      });
    }
  }
}
export type ManagedSyncsServiceContract = Pick<
  ManagedSyncsService,
  'list' | 'configureApp' | 'connect' | 'completeConnection' | 'update'
>;
