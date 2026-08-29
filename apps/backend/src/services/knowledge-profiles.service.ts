import { readableIdFrom } from '#knowledge/knowledge-address.ts';
import type {
  KnowledgeProfile,
  KnowledgeProfilesRepositoryContract,
} from '#profiles/knowledge-profile.ts';
import { Service } from '#services/service.ts';

export type KnowledgeProfileMutationResult =
  | { state: 'created'; profile: KnowledgeProfile }
  | { state: 'profile_exists' }
  | { state: 'readable_id_conflict'; readableId: string }
  | { state: 'readable_id_required' };

export class KnowledgeProfilesService extends Service {
  private readonly profiles: KnowledgeProfilesRepositoryContract;

  constructor(profiles: KnowledgeProfilesRepositoryContract) {
    super();
    this.profiles = profiles;
  }

  async create(input: {
    ownerId: string;
    readableId?: string;
    name: string;
    description: string;
  }): Promise<KnowledgeProfileMutationResult> {
    const readableId = input.readableId ?? readableIdFrom(input.name);
    if (!readableId) {
      return { state: 'readable_id_required' };
    }
    const result = await this.profiles.create({
      ownerId: input.ownerId,
      entityId: Bun.randomUUIDv7(),
      readableId,
      name: input.name.trim(),
      description: input.description.trim(),
      createdAt: new Date().toISOString(),
    });
    return result.state === 'readable_id_conflict' ? { state: result.state, readableId } : result;
  }

  find({ ownerId }: { ownerId: string }): Promise<KnowledgeProfile | null> {
    return this.profiles.find({ ownerId });
  }
}

export type KnowledgeProfilesServiceContract = Pick<KnowledgeProfilesService, 'create' | 'find'>;
