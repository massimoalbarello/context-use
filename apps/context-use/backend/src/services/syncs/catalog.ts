import type {
  SyncContext,
  SyncDefinition,
  SyncPage,
  SyncRegistration,
} from '@context-use/open-sync/definition';
import { z } from 'zod';
import { NotFoundError } from '#backend/lib/errors.ts';
import { type RecordInput, RecordInputSchema } from '#backend/models/records/model.ts';

export interface RecordSyncPage extends Omit<SyncPage, 'deliverable'> {
  deliverable: {
    records: { operation: 'upsert'; kind: string; id: string; data: RecordInput }[];
  };
}
export interface ContextSync {
  key: string;
  name: string;
  description: string;
  intervalMs: number;
  registration: SyncRegistration;
}
export interface SyncProvider {
  id: string;
  name: string;
  description: string;
  oauth: { createAppUrl: string; authorizationOptionIds: string[] };
  syncs: readonly ContextSync[];
}

export function defineRecordSync(input: {
  key: string;
  name: string;
  description: string;
  intervalMs: number;
  definition: Omit<SyncDefinition, 'kinds'>;
  kinds: readonly string[];
  run(context: SyncContext): AsyncIterable<RecordSyncPage>;
}): ContextSync {
  const schema = JSON.parse(JSON.stringify(z.toJSONSchema(RecordInputSchema, { io: 'input' })));
  return {
    key: input.key,
    name: input.name,
    description: input.description,
    intervalMs: input.intervalMs,
    registration: {
      definition: {
        ...input.definition,
        kinds: Object.fromEntries(input.kinds.map((kind) => [kind, schema])),
      },
      load: () => ({ run: input.run }),
    },
  };
}

export class SyncCatalog {
  readonly definitions: SyncRegistration[] = [];
  constructor(readonly providers: readonly SyncProvider[]) {
    const identities = new Set<string>();
    for (const provider of providers) {
      this.unique({ identities, key: `provider:${provider.id}` });
      for (const sync of provider.syncs) {
        const definition = sync.registration.definition;
        this.unique({ identities, key: `sync:${sync.key}` });
        this.unique({ identities, key: `definition:${definition.id}` });
        if (definition.provider?.service !== provider.id) {
          throw new Error('Sync definition must use its registered provider.');
        }
        this.definitions.push(sync.registration);
      }
    }
  }
  private unique(input: { identities: Set<string>; key: string }) {
    if (input.identities.has(input.key)) {
      throw new Error(`Duplicate sync registration: ${input.key}`);
    }
    input.identities.add(input.key);
  }
  provider(id: string) {
    const provider = this.providers.find((item) => item.id === id);
    if (!provider) {
      throw new NotFoundError('Sync provider not found.');
    }
    return provider;
  }
  sync(key: string) {
    for (const provider of this.providers) {
      const sync = provider.syncs.find((item) => item.key === key);
      if (sync) {
        return { provider, sync };
      }
    }
    throw new NotFoundError('Sync not found.');
  }
}
