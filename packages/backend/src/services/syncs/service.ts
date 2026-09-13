import { OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import { readableIdFrom, readableIdWithSuffix } from '#models/readable-ids/model.ts';
import { isUuidV7, normalizeSyncName } from '#models/syncs/model.ts';
import type { RecordSyncsRepositoryContract } from '#repositories/syncs/repository.ts';

const READABLE_ID_SUFFIX_LENGTH = 24;
const MAX_IDENTITY_ATTEMPTS = 3;

function sha256(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

export class RecordSyncsService {
  private readonly syncs: RecordSyncsRepositoryContract;
  private readonly now: () => Date;
  private readonly createUuidV7: () => string;

  constructor({
    syncs,
    now = () => new Date(),
    createUuidV7 = () => Bun.randomUUIDv7(),
  }: {
    syncs: RecordSyncsRepositoryContract;
    now?: () => Date;
    createUuidV7?: () => string;
  }) {
    this.syncs = syncs;
    this.now = now;
    this.createUuidV7 = createUuidV7;
  }

  private isOwner(actorId: string): boolean {
    return actorId === OWNER_USER_ID;
  }

  async create({ actorId, name: rawName }: { actorId: string; name: string }) {
    if (!this.isOwner(actorId)) {
      return { state: 'forbidden' as const };
    }
    const name = normalizeSyncName(rawName);
    if (!name) {
      return { state: 'invalid' as const };
    }

    for (let attempt = 0; attempt < MAX_IDENTITY_ATTEMPTS; attempt += 1) {
      const id = this.createUuidV7();
      const apiKey = this.createUuidV7();
      if (!isUuidV7(id) || !isUuidV7(apiKey)) {
        throw new Error('Record sync identifiers must be UUIDv7 values');
      }
      const result = await this.syncs.create({
        id,
        ownerId: actorId,
        readableId: readableIdWithSuffix({
          readableId: readableIdFrom(name),
          suffix: sha256(id).slice(0, READABLE_ID_SUFFIX_LENGTH),
        }),
        name,
        apiKeySha256: sha256(apiKey),
        createdAt: this.now().toISOString(),
      });
      if (result.state === 'created') {
        return { state: 'created' as const, sync: result.sync, apiKey };
      }
      if (result.state === 'name_conflict') {
        return { state: 'name_conflict' as const };
      }
    }
    throw new Error('Could not allocate a unique record sync identity');
  }

  async list({ actorId }: { actorId: string }) {
    if (!this.isOwner(actorId)) {
      return { state: 'forbidden' as const };
    }
    return { state: 'found' as const, syncs: await this.syncs.list({ ownerId: actorId }) };
  }

  async revoke({ actorId, readableId }: { actorId: string; readableId: string }) {
    if (!this.isOwner(actorId)) {
      return { state: 'forbidden' as const };
    }
    const revoked = await this.syncs.revoke({
      ownerId: actorId,
      readableId,
      revokedAt: this.now().toISOString(),
    });
    return { state: revoked ? ('revoked' as const) : ('not_found' as const) };
  }

  async authenticate({ apiKey }: { apiKey: string }) {
    if (!isUuidV7(apiKey)) {
      return null;
    }
    return await this.syncs.authenticateApiKeyFingerprint({ apiKeySha256: sha256(apiKey) });
  }
}

export type RecordSyncsServiceContract = Pick<RecordSyncsService, 'create' | 'list' | 'revoke'>;
export type RecordSyncAuthenticationContract = Pick<RecordSyncsService, 'authenticate'>;
