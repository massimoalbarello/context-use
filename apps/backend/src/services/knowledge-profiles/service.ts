import type { KnowledgeProfile } from '#models/knowledge-profiles/model.ts';
import {
  READABLE_ID_SUFFIX_LENGTH,
  readableIdFrom,
  readableIdWithSuffix,
} from '#models/readable-ids/model.ts';
import type { KnowledgeProfilesRepositoryContract } from '#repositories/knowledge-profiles/repository.ts';

export type KnowledgeProfileMutationResult =
  | { state: 'created'; profile: KnowledgeProfile }
  | { state: 'profile_exists' }
  | { state: 'name_conflict' };

export class KnowledgeProfilesService {
  private readonly profiles: KnowledgeProfilesRepositoryContract;

  constructor(profiles: KnowledgeProfilesRepositoryContract) {
    this.profiles = profiles;
  }

  async create(input: {
    ownerId: string;
    name: string;
    description: string;
    allowDuplicate?: boolean;
  }): Promise<KnowledgeProfileMutationResult> {
    const derivedReadableId = readableIdFrom(input.name);
    const readableId = input.allowDuplicate
      ? readableIdWithSuffix({
          readableId: derivedReadableId,
          suffix: Bun.randomUUIDv7().slice(-READABLE_ID_SUFFIX_LENGTH),
        })
      : derivedReadableId;
    const result = await this.profiles.create({
      ownerId: input.ownerId,
      entityId: Bun.randomUUIDv7(),
      readableId,
      name: input.name.trim(),
      description: input.description.trim(),
      createdAt: new Date().toISOString(),
    });
    return result.state === 'readable_id_conflict' ? { state: 'name_conflict' } : result;
  }

  find({ ownerId }: { ownerId: string }): Promise<KnowledgeProfile | null> {
    return this.profiles.find({ ownerId });
  }
}

export type KnowledgeProfilesServiceContract = Pick<KnowledgeProfilesService, 'create' | 'find'>;
