import type { Entity, EntityDetail, EntityRepositoryContract } from '#entities/entity.ts';
import { readableIdFrom } from '#knowledge/knowledge-address.ts';
import type { KnowledgePagesRepositoryContract } from '#pages/knowledge-page.ts';
import { Service } from '#services/service.ts';

export class EntitiesService extends Service {
  private readonly entities: EntityRepositoryContract;
  private readonly pages: Pick<KnowledgePagesRepositoryContract, 'listByEntity'>;

  constructor({
    entities,
    pages,
  }: {
    entities: EntityRepositoryContract;
    pages: Pick<KnowledgePagesRepositoryContract, 'listByEntity'>;
  }) {
    super();
    this.entities = entities;
    this.pages = pages;
  }

  create(input: {
    ownerId: string;
    readableId?: string;
    name: string;
    description: string;
  }): Promise<
    | { state: 'created'; entity: Entity }
    | { state: 'readable_id_conflict'; readableId: string }
    | { state: 'readable_id_required' }
  > {
    const readableId = input.readableId ?? readableIdFrom(input.name);
    if (!readableId) {
      return Promise.resolve({ state: 'readable_id_required' });
    }
    return this.entities
      .create({
        id: Bun.randomUUIDv7(),
        ownerId: input.ownerId,
        readableId,
        name: input.name.trim(),
        description: input.description.trim(),
        createdAt: new Date().toISOString(),
      })
      .then((result) =>
        result.state === 'readable_id_conflict' ? { state: result.state, readableId } : result,
      );
  }

  list(input: { ownerId: string; limit: number; offset: number; query?: string }) {
    return this.entities.list(input);
  }

  async detail({
    ownerId,
    readableId,
  }: {
    ownerId: string;
    readableId: string;
  }): Promise<EntityDetail | null> {
    const entity = await this.entities.find({ ownerId, readableId });
    if (!entity) {
      return null;
    }
    const pages = await this.pages.listByEntity({ ownerId, entityReadableId: readableId });
    return { ...entity, pages };
  }

  update(input: {
    ownerId: string;
    readableId: string;
    name: string;
    description: string;
  }): Promise<Entity | null> {
    return this.entities.update({
      ownerId: input.ownerId,
      readableId: input.readableId,
      name: input.name.trim(),
      description: input.description.trim(),
      updatedAt: new Date().toISOString(),
    });
  }
}

export type EntitiesServiceContract = Pick<
  EntitiesService,
  'create' | 'list' | 'detail' | 'update'
>;
