import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { isUuidV7, normalizeApiKeyName } from '#backend/models/api-keys/model.ts';
import { readableIdFrom, readableIdWithSuffix } from '#backend/models/readable-ids/model.ts';
import type { ApiKeysRepositoryContract } from '#backend/repositories/api-keys/repository.ts';

const READABLE_ID_SUFFIX_LENGTH = 24;
const MAX_IDENTITY_ATTEMPTS = 3;

function sha256(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

export class ApiKeysService {
  private readonly keys: ApiKeysRepositoryContract;
  private readonly now: () => Date;
  private readonly createUuidV7: () => string;

  constructor({
    keys,
    now = () => new Date(),
    createUuidV7 = () => Bun.randomUUIDv7(),
  }: {
    keys: ApiKeysRepositoryContract;
    now?: () => Date;
    createUuidV7?: () => string;
  }) {
    this.keys = keys;
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
    const name = normalizeApiKeyName(rawName);
    if (!name) {
      return { state: 'invalid' as const };
    }

    for (let attempt = 0; attempt < MAX_IDENTITY_ATTEMPTS; attempt += 1) {
      const id = this.createUuidV7();
      const apiKey = this.createUuidV7();
      if (!isUuidV7(id) || !isUuidV7(apiKey)) {
        throw new Error('API key identifiers must be UUIDv7 values');
      }
      const result = await this.keys.create({
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
        return { state: 'created' as const, key: result.key, apiKey };
      }
      if (result.state === 'name_conflict') {
        return { state: 'name_conflict' as const };
      }
    }
    throw new Error('Could not allocate a unique API key identity');
  }

  async list({ actorId }: { actorId: string }) {
    if (!this.isOwner(actorId)) {
      return { state: 'forbidden' as const };
    }
    return { state: 'found' as const, keys: await this.keys.list({ ownerId: actorId }) };
  }

  async revoke({ actorId, readableId }: { actorId: string; readableId: string }) {
    if (!this.isOwner(actorId)) {
      return { state: 'forbidden' as const };
    }
    const revoked = await this.keys.revoke({
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
    return await this.keys.authenticateApiKeyFingerprint({ apiKeySha256: sha256(apiKey) });
  }
}

export type ApiKeysServiceContract = Pick<ApiKeysService, 'create' | 'list' | 'revoke'>;
export type ApiKeyAuthenticationContract = Pick<ApiKeysService, 'authenticate'>;
