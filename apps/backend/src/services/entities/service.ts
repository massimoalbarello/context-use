import type { Entity, EntityDetail, EntityType, EntityTypeFilter } from '#models/entities/model.ts';
import {
  READABLE_ID_SUFFIX_LENGTH,
  readableIdFrom,
  readableIdWithSuffix,
} from '#models/readable-ids/model.ts';
import type { EntityRepositoryContract } from '#repositories/entities/repository.ts';
import type { KnowledgePagesRepositoryContract } from '#repositories/knowledge-pages/repository.ts';

export class EntitiesService {
  private readonly entities: EntityRepositoryContract;
  private readonly pages: Pick<KnowledgePagesRepositoryContract, 'listByEntity'>;

  constructor({
    entities,
    pages,
  }: {
    entities: EntityRepositoryContract;
    pages: Pick<KnowledgePagesRepositoryContract, 'listByEntity'>;
  }) {
    this.entities = entities;
    this.pages = pages;
  }

  create(input: {
    ownerId: string;
    name: string;
    description: string;
    entityType?: EntityType | null;
    allowDuplicate?: boolean;
  }): Promise<{ state: 'created'; entity: Entity } | { state: 'name_conflict' }> {
    const derivedReadableId = readableIdFrom(input.name);
    const readableId = input.allowDuplicate
      ? readableIdWithSuffix({
          readableId: derivedReadableId,
          suffix: Bun.randomUUIDv7().slice(-READABLE_ID_SUFFIX_LENGTH),
        })
      : derivedReadableId;
    return this.entities
      .create({
        id: Bun.randomUUIDv7(),
        ownerId: input.ownerId,
        readableId,
        name: input.name.trim(),
        description: input.description.trim(),
        entityType: input.entityType,
        createdAt: new Date().toISOString(),
      })
      .then((result) =>
        result.state === 'readable_id_conflict' ? { state: 'name_conflict' as const } : result,
      );
  }

  list(input: { ownerId: string; limit: number; offset: number; entityType?: EntityTypeFilter }) {
    return this.entities.list(input);
  }

  async detail({
    ownerId,
    readableId,
    pageLimit,
  }: {
    ownerId: string;
    readableId: string;
    pageLimit?: number;
  }): Promise<EntityDetail | null> {
    const entity = await this.entities.find({ ownerId, readableId });
    if (!entity) {
      return null;
    }
    const pages = await this.pages.listByEntity({
      ownerId,
      entityReadableId: readableId,
      limit: pageLimit,
    });
    return { ...entity, pages };
  }

  update(input: {
    ownerId: string;
    readableId: string;
    name: string;
    description: string;
    entityType?: EntityType | null;
  }): Promise<Entity | null> {
    return this.entities.update({
      ownerId: input.ownerId,
      readableId: input.readableId,
      name: input.name.trim(),
      description: input.description.trim(),
      entityType: input.entityType,
      updatedAt: new Date().toISOString(),
    });
  }

  archive(input: { ownerId: string; readableId: string }) {
    return this.entities.archive({
      ownerId: input.ownerId,
      readableId: input.readableId,
      archivedAt: new Date().toISOString(),
    });
  }
}

export type EntitiesServiceContract = Pick<
  EntitiesService,
  'create' | 'list' | 'detail' | 'update' | 'archive'
>;
