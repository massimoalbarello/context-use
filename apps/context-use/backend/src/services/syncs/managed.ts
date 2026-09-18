import type { OpenSyncRuntime } from '@context-use/open-sync';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { BadRequestError, ForbiddenError, NotFoundError } from '#backend/lib/errors.ts';
import type {
  ManagedSyncState,
  ManagedSyncSummary,
  SyncProviderSummary,
} from '#backend/models/syncs/managed.ts';
import { LOCAL_RECORD_DESTINATION } from '#backend/models/syncs/managed.ts';
import type { CountRecordsInput } from '#backend/repositories/records/repository.ts';
import type { ContextSync, SyncCatalog, SyncProvider } from './catalog.ts';

const HEALTHY_STATES = new Set([
  'ready',
  'running',
  'yielded',
  'succeeded',
  'disabled',
  'cancelled',
]);
type Scope = { actorId: string; ownerId: string };
type Queue = { blocked: string[]; pending: number };
type Installation = ReturnType<OpenSyncRuntime['api']['installations']>[number];

function managedState(input: {
  configured: boolean;
  connected: boolean;
  connectionActive: boolean;
  installation: Installation | undefined;
  queue: Queue;
}): { state: ManagedSyncState; message: string } {
  if (!input.configured) {
    return { state: 'setup-required', message: 'Set up your OAuth app to get started.' };
  }
  if (!input.connected || !input.installation) {
    return { state: 'disconnected', message: 'Connect your account to start syncing.' };
  }
  if (!input.installation.enabled) {
    return { state: 'paused', message: 'Automatic syncing is paused. Your records are kept.' };
  }
  if (input.queue.blocked.length) {
    return {
      state: 'error',
      message: 'Some records could not be saved. Try syncing again.',
    };
  }
  if (!input.connectionActive || !HEALTHY_STATES.has(input.installation.status)) {
    return { state: 'error', message: 'This sync could not finish. Automatic retries continue.' };
  }
  if (input.queue.pending) {
    return { state: 'syncing', message: 'Saving records…' };
  }
  if (['ready', 'running', 'yielded'].includes(input.installation.status)) {
    return { state: 'syncing', message: 'Checking for changes…' };
  }
  return { state: 'ready', message: 'Up to date. New changes are checked automatically.' };
}

export class ManagedSyncsService {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly input: {
      sync: Pick<OpenSyncRuntime, 'api' | 'providers'>;
      countRecords(input: CountRecordsInput): Promise<number>;
      catalog: SyncCatalog;
    },
  ) {}

  private scope(actorId: string): Scope {
    if (actorId !== OWNER_USER_ID) {
      throw new ForbiddenError();
    }
    return { actorId, ownerId: actorId };
  }
  private installation(input: { scope: Scope; sync: ContextSync }) {
    return this.input.sync.api
      .installations(input.scope)
      .find((item) => item.definition.id === input.sync.registration.definition.id);
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.pending.then(action, action);
    this.pending = next.catch(() => {});
    return next;
  }
  private queues(scope: Scope) {
    const queues = new Map<string, Queue>();
    let offset = 0;
    while (true) {
      const page = this.input.sync.api.deliveries({ ...scope, offset });
      for (const item of page.deliveries) {
        const queue = queues.get(item.installationId) ?? { blocked: [], pending: 0 };
        if (item.state === 'blocked') {
          queue.blocked.push(item.id);
        } else {
          queue.pending += item.recordCount;
        }
        queues.set(item.installationId, queue);
      }
      if (!page.hasMore) {
        return queues;
      }
      offset += page.pageSize;
    }
  }
  async list(input: { actorId: string }): Promise<SyncProviderSummary[]> {
    const scope = this.scope(input.actorId);
    const queues = this.queues(scope);
    const installations = this.input.sync.api.installations(scope);
    return await Promise.all(
      this.input.catalog.providers.map(async (provider) => {
        const status = await this.input.sync.providers.status({ ...scope, service: provider.id });
        const oauth = status.setup.oauthClient;
        if (!oauth) {
          throw new BadRequestError('OAuth app setup is unavailable.');
        }
        const connection = status.connections[0];
        const syncs = await Promise.all(
          provider.syncs.map(async (sync): Promise<ManagedSyncSummary> => {
            const installation = installations.find(
              (item) => item.definition.id === sync.registration.definition.id,
            );
            const bound = status.connections.find(
              (item) => item.id === installation?.connection?.id,
            );
            const recordCount = await this.input.countRecords({
              ownerId: scope.ownerId,
              provider: provider.id,
              kinds: Object.keys(sync.registration.definition.kinds),
            });
            const runs = installation
              ? this.input.sync.api.runs({ ...scope, id: installation.id }).runs
              : [];
            const lastSuccess = runs.find((run) => run.state === 'succeeded');
            return {
              key: sync.key,
              name: sync.name,
              description: sync.description,
              provider: provider.id,
              kinds: Object.keys(sync.registration.definition.kinds),
              intervalMs: sync.intervalMs,
              ...managedState({
                configured: oauth.configured,
                connected: Boolean(connection),
                connectionActive: bound?.status === 'active',
                installation,
                queue: queues.get(installation?.id ?? '') ?? { blocked: [], pending: 0 },
              }),
              recordCount,
              lastSyncedAt: lastSuccess?.completedAt
                ? new Date(lastSuccess.completedAt).toISOString()
                : null,
              nextSyncAt: installation?.enabled
                ? new Date(installation.nextDueAt).toISOString()
                : null,
            };
          }),
        );
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
      if (this.installation({ scope, sync })) {
        continue;
      }
      // Open Sync orders deliveries per destination, so each sync needs its own queue.
      const destination = this.input.sync.api.createDestination({
        ...scope,
        type: LOCAL_RECORD_DESTINATION,
        config: {},
      });
      await this.input.sync.api.createInstallation({
        ...scope,
        definition: sync.registration.definition,
        connection,
        config: {},
        destinationId: destination.id,
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
    const installation = this.installation({ scope, sync });
    if (!installation) {
      throw new NotFoundError('Connect your account first.');
    }
    if (input.action === 'run') {
      if (!installation.enabled) {
        throw new BadRequestError('Resume the sync first.');
      }
      for (const id of this.queues(scope).get(installation.id)?.blocked ?? []) {
        this.input.sync.api.retryDelivery({ ...scope, id });
      }
      this.input.sync.api.queueRun({ ...scope, id: installation.id });
    } else {
      await this.input.sync.api.setEnabled({
        ...scope,
        id: installation.id,
        enabled: input.action === 'resume',
      });
    }
  }
}
export type ManagedSyncsServiceContract = Pick<
  ManagedSyncsService,
  'list' | 'configureApp' | 'connect' | 'completeConnection' | 'update'
>;
