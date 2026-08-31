import { isEmbeddableAssetMedia } from '#models/assets/media.ts';
import type { Entity, EntityDetail } from '#models/entities/model.ts';
import {
  READABLE_ID_SUFFIX_LENGTH,
  readableIdFrom,
  readableIdWithSuffix,
} from '#models/readable-ids/model.ts';
import type { AssetsRepositoryContract } from '#repositories/assets/repository.ts';
import type { EntityRepositoryContract } from '#repositories/entities/repository.ts';
import type { KnowledgePagesRepositoryContract } from '#repositories/knowledge-pages/repository.ts';

export class EntitiesService {
  private readonly assets: Pick<AssetsRepositoryContract, 'find'>;
  private readonly entities: EntityRepositoryContract;
  private readonly pages: Pick<KnowledgePagesRepositoryContract, 'listByEntity'>;

  constructor({
    assets,
    entities,
    pages,
  }: {
    assets: Pick<AssetsRepositoryContract, 'find'>;
    entities: EntityRepositoryContract;
    pages: Pick<KnowledgePagesRepositoryContract, 'listByEntity'>;
  }) {
    this.assets = assets;
    this.entities = entities;
    this.pages = pages;
  }

  create(input: {
    ownerId: string;
    name: string;
    description: string;
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
        createdAt: new Date().toISOString(),
      })
      .then((result) =>
        result.state === 'readable_id_conflict' ? { state: 'name_conflict' as const } : result,
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

  async setImage(input: {
    ownerId: string;
    readableId: string;
    assetReadableId: string;
  }): Promise<
    { state: 'updated'; entity: Entity } | { state: 'not_found' } | { state: 'invalid_asset_type' }
  > {
    const asset = await this.assets.find({
      ownerId: input.ownerId,
      readableId: input.assetReadableId,
    });
    if (!asset) {
      return { state: 'not_found' };
    }
    if (!isEmbeddableAssetMedia(asset.mediaType)) {
      return { state: 'invalid_asset_type' };
    }
    const entity = await this.entities.setImage({
      ownerId: input.ownerId,
      readableId: input.readableId,
      assetId: asset.id,
      updatedAt: new Date().toISOString(),
    });
    return entity ? { state: 'updated', entity } : { state: 'not_found' };
  }

  removeImage(input: { ownerId: string; readableId: string }): Promise<Entity | null> {
    return this.entities.removeImage({ ...input, updatedAt: new Date().toISOString() });
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
  'create' | 'list' | 'detail' | 'update' | 'setImage' | 'removeImage' | 'archive'
>;
